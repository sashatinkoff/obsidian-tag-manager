/*
 * Tag Refactor & Auditor — Obsidian plugin bundle
 * Generated from the decomposed source modules in source-modules/.
 * Obsidian loads this single file; local module imports are intentionally bundled.
 */
const obsidian_1 = require("obsidian");


/* ===== constants.js ===== */
const VIEW_TYPE = "tag-refactor-auditor-view";
const DEFAULT_SETTINGS = {
  previewChars: 400,
  caseSensitive: false,
  ignoredFolders: ["Templates"],
  createdDateProperty: "",
  minTagMentions: 0
};


/* ===== tag-utils.js ===== */
function normalizeTag(value) {
    if (typeof value !== "string")
        return null;
    let tag = value.trim();
    if (tag.startsWith("#"))
        tag = tag.slice(1);
    tag = tag.trim();
    if (!tag || tag.includes("\n") || tag.includes("\r"))
        return null;
    return tag;
}
function tagKey(tag, caseSensitive) {
    const normalized = normalizeTag(tag) ?? tag.trim();
    return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}
function isValidTag(value) {
    const tag = (normalizeTag(value) ?? "").trim();
    // Match Obsidian's common tag characters and hierarchy separator. The regexp
    // supports Unicode letters, including Cyrillic and accented characters.
    return /^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag);
}
function cleanTagInput(value) {
    return value.trim().replace(/^#+/, "").trim();
}
function collectFrontmatterTags(frontmatter) {
    if (!frontmatter || typeof frontmatter !== "object")
        return [];
    const record = frontmatter;
    const found = [];
    for (const field of ["tags", "tag"]) {
        const value = record[field];
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
            const tag = normalizeTag(item);
            if (tag)
                found.push(tag);
        }
    }
    return found;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function makeChangeMap(changes, caseSensitive) {
    const map = new Map();
    for (const change of changes) {
        const oldTag = normalizeTag(change.oldTag);
        const action = change.action === "unmark"
            ? "unmark"
            : change.action === "delete" || change.newTag === null
                ? "delete"
                : "rename";
        const newTag = action === "rename" ? normalizeTag(change.newTag) : null;
        if (!oldTag || (action === "rename" && !newTag))
            continue;
        map.set(tagKey(oldTag, caseSensitive), { action, newTag });
    }
    return map;
}
/**
 * Replace tags in Markdown body text, while leaving fenced and inline code alone.
 * A single alternation performs all replacements against the original text, so
 * chained mappings do not cascade (A -> B and B -> C leaves original A as B).
 */
function replaceBodyTags(body, changes, caseSensitive) {
    const changeMap = makeChangeMap(changes, caseSensitive);
    const names = changes
        .map((change) => normalizeTag(change.oldTag))
        .filter((tag) => Boolean(tag))
        .sort((a, b) => b.length - a.length);
    if (names.length === 0)
        return { text: body, changed: false };
    const flags = caseSensitive ? "gu" : "giu";
    // The lookbehind prevents matches embedded in another tag/word; the trailing
    // boundary avoids changing #tag inside #tagging or a nested #tag/child.
    const tagPattern = new RegExp(`(?<![\\p{L}\\p{N}_/#-])#(?:${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_/-])`, flags);
    let changed = false;
    const lines = body.split(/(\r?\n)/);
    let fenceChar = null;
    let fenceLength = 0;
    const replacedLines = lines.map((line) => {
        if (line === "\n" || line === "\r\n")
            return line;
        const fence = line.match(/^\s*(`{3,}|~{3,})/);
        if (fence) {
            const marker = fence[1];
            const markerChar = marker[0];
            if (fenceChar === null) {
                fenceChar = markerChar;
                fenceLength = marker.length;
            }
            else if (fenceChar === markerChar && marker.length >= fenceLength) {
                fenceChar = null;
                fenceLength = 0;
            }
            return line;
        }
        if (fenceChar !== null)
            return line;
        // Split around inline code spans and substitute only in normal Markdown text.
        const parts = line.split(/(`+[^`]*`+)/g);
        return parts
            .map((part, index) => {
            if (index % 2 === 1 && /^`+/.test(part))
                return part;
            return part.replace(tagPattern, (matched) => {
                const rawOld = matched.slice(1);
                const key = tagKey(rawOld, caseSensitive);
                if (!changeMap.has(key))
                    return matched;
                const operation = changeMap.get(key);
                changed = true;
                if (operation.action === "delete")
                    return "";
                if (operation.action === "unmark")
                    return rawOld;
                return `#${operation.newTag}`;
            });
        })
            .join("");
    });
    return { text: replacedLines.join(""), changed };
}
function splitFlowList(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
        return null;
    const inner = trimmed.slice(1, -1);
    const parts = [];
    let quote = null;
    let escaped = false;
    let start = 0;
    for (let i = 0; i < inner.length; i += 1) {
        const char = inner[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\" && quote === '"') {
            escaped = true;
            continue;
        }
        if (quote === "'") {
            if (char === "'" && inner[i + 1] === "'") {
                i += 1;
                continue;
            }
            if (char === "'")
                quote = null;
            continue;
        }
        if (quote === '"') {
            if (char === '"')
                quote = null;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (char === ",") {
            parts.push(inner.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(inner.slice(start));
    return parts;
}
function decodeYamlScalar(token) {
    const trimmed = token.trim();
    if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
        return { value: trimmed.slice(1, -1).replace(/''/g, "'"), quote: "'" };
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
        try {
            return { value: JSON.parse(trimmed), quote: '"' };
        }
        catch {
            return { value: trimmed.slice(1, -1), quote: '"' };
        }
    }
    return { value: trimmed, quote: null };
}
function encodeYamlScalar(value, quote) {
    if (quote === "'")
        return `'${value.replace(/'/g, "''")}'`;
    if (quote === '"')
        return JSON.stringify(value);
    // New names are validated to the conservative tag character set, so they are
    // safe as plain YAML scalars and do not need extra quoting.
    return value;
}
function replaceYamlScalar(raw, changes, caseSensitive) {
    const leading = raw.match(/^\s*/)?.[0] ?? "";
    const afterLeading = raw.slice(leading.length);
    if (!afterLeading)
        return raw;
    let token = afterLeading;
    let suffix = "";
    const first = token[0];
    if (first === "'" || first === '"') {
        let end = -1;
        for (let i = 1; i < token.length; i += 1) {
            if (first === '"' && token[i] === "\\") {
                i += 1;
                continue;
            }
            if (token[i] === first) {
                if (first === "'" && token[i + 1] === "'") {
                    i += 1;
                    continue;
                }
                end = i;
                break;
            }
        }
        if (end >= 0) {
            suffix = token.slice(end + 1);
            token = token.slice(0, end + 1);
        }
    }
    else {
        const commentAt = token.search(/\s+#/);
        if (commentAt >= 0) {
            suffix = token.slice(commentAt);
            token = token.slice(0, commentAt).trimEnd();
        }
    }
    const trailing = token.match(/\s*$/)?.[0] ?? "";
    const scalarToken = token.slice(0, token.length - trailing.length);
    const decoded = decodeYamlScalar(scalarToken);
    const normalized = normalizeTag(decoded.value);
    if (!normalized)
        return raw;
    const key = tagKey(normalized, caseSensitive);
    if (!changes.has(key))
        return raw;
    const operation = changes.get(key);
    // YAML `tags` / `tag` fields are metadata rather than visible text. Both a
    // full delete and an unmark operation remove the matching metadata entry;
    // unmark preserves the plain word in Markdown body text.
    if (operation.action === "delete" || operation.action === "unmark")
        return null;
    return `${leading}${encodeYamlScalar(operation.newTag, decoded.quote)}${trailing}${suffix}`;
}
function replaceYamlLineValue(line, colonIndex, changes, caseSensitive) {
    const prefix = line.slice(0, colonIndex + 1);
    const value = line.slice(colonIndex + 1);
    const leading = value.match(/^\s*/)?.[0] ?? "";
    const remaining = value.slice(leading.length);
    if (remaining.startsWith("[")) {
        const closingIndex = findFlowListClosing(remaining);
        if (closingIndex < 0)
            return { line, changed: false };
        const inside = remaining.slice(1, closingIndex);
        const items = splitFlowList(`[${inside}]`);
        if (!items)
            return { line, changed: false };
        let changed = false;
        let removedAny = false;
        const rewrittenItems = [];
        for (const item of items) {
            const next = replaceYamlScalar(item, changes, caseSensitive);
            if (next !== item)
                changed = true;
            if (next === null) {
                removedAny = true;
                continue;
            }
            rewrittenItems.push(next);
        }
        if (removedAny && rewrittenItems.length === 0)
            return { line: null, changed: true };
        return {
            line: `${prefix}${leading}[${rewrittenItems.join(",")}]${remaining.slice(closingIndex + 1)}`,
            changed,
        };
    }
    const rewritten = replaceYamlScalar(value, changes, caseSensitive);
    if (rewritten === null)
        return { line: null, changed: true };
    return { line: `${prefix}${rewritten}`, changed: rewritten !== value };
}
function findFlowListClosing(value) {
    let quote = null;
    let escaped = false;
    for (let i = 1; i < value.length; i += 1) {
        const char = value[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\" && quote === '"') {
            escaped = true;
            continue;
        }
        if (quote === "'") {
            if (char === "'" && value[i + 1] === "'") {
                i += 1;
                continue;
            }
            if (char === "'")
                quote = null;
            continue;
        }
        if (quote === '"') {
            if (char === '"')
                quote = null;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (char === "]")
            return i;
    }
    return -1;
}
function replaceYamlTags(frontmatter, changes, caseSensitive) {
    const changeMap = makeChangeMap(changes, caseSensitive);
    if (changeMap.size === 0)
        return { text: frontmatter, changed: false };
    try {
        (0, obsidian_1.parseYaml)(frontmatter);
    }
    catch {
        return { text: frontmatter, changed: false };
    }
    const newline = frontmatter.includes("\r\n") ? "\r\n" : "\n";
    const lines = frontmatter.split(/\r?\n/);
    let changed = false;
    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].match(/^(tags?|tag)\s*:/);
        if (!match)
            continue;
        const colonIndex = lines[i].indexOf(":");
        const rewritten = replaceYamlLineValue(lines[i], colonIndex, changeMap, caseSensitive);
        if (rewritten.line === null) {
            lines.splice(i, 1);
            i -= 1;
            changed = true;
            continue;
        }
        lines[i] = rewritten.line;
        changed ||= rewritten.changed;
        const valueAfterColon = lines[i].slice(colonIndex + 1).trim();
        if (valueAfterColon !== "")
            continue;

        // Process block arrays such as `tags:\n  - one`. Removing a scalar removes
        // that list item; if all items were removed, remove the now-empty property.
        let hadListItem = false;
        for (let j = i + 1; j < lines.length; j += 1) {
            if (lines[j].trim() === "")
                continue;
            if (!/^\s/.test(lines[j]))
                break;
            const listItem = lines[j].match(/^(\s*-\s+)(.*)$/);
            if (!listItem)
                continue;
            hadListItem = true;
            const replacement = replaceYamlScalar(listItem[2], changeMap, caseSensitive);
            if (replacement === null) {
                lines.splice(j, 1);
                j -= 1;
                changed = true;
                continue;
            }
            if (replacement !== listItem[2]) {
                lines[j] = `${listItem[1]}${replacement}`;
                changed = true;
            }
        }
        if (hadListItem) {
            let hasRemainingListItem = false;
            for (let j = i + 1; j < lines.length; j += 1) {
                if (lines[j].trim() === "")
                    continue;
                if (!/^\s/.test(lines[j]))
                    break;
                if (/^\s*-\s+/.test(lines[j])) {
                    hasRemainingListItem = true;
                    break;
                }
            }
            if (!hasRemainingListItem) {
                lines.splice(i, 1);
                i -= 1;
                changed = true;
            }
        }
    }
    const result = lines.join(newline);
    try {
        (0, obsidian_1.parseYaml)(result);
        return { text: result, changed };
    }
    catch {
        return { text: frontmatter, changed: false };
    }
}
/** Apply queued tag operations to one file without writing it. */
function replaceTagsInMarkdown(content, changes, caseSensitive) {
    const frontmatterMatch = content.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---\s*(?:\r?\n|$))/);
    if (!frontmatterMatch)
        return replaceBodyTags(content, changes, caseSensitive);
    const [whole, opening, frontmatter, closing] = frontmatterMatch;
    const afterFrontmatter = content.slice(whole.length);
    const yaml = replaceYamlTags(frontmatter, changes, caseSensitive);
    const body = replaceBodyTags(afterFrontmatter, changes, caseSensitive);
    const next = `${opening}${yaml.text}${closing}${body.text}`;
    return { text: next, changed: yaml.changed || body.changed };
}
function findInlineTagIndex(content, tag, caseSensitive) {
    const escaped = escapeRegExp(normalizeTag(tag) ?? tag);
    const flags = caseSensitive ? "u" : "iu";
    const regex = new RegExp(`(?<![\\p{L}\\p{N}_/#-])#${escaped}(?![\\p{L}\\p{N}_/-])`, flags);
    const match = regex.exec(content);
    return match?.index ?? -1;
}


/* ===== utils.js ===== */
function appendExcerptWithHighlight(parent, excerpt, tag, caseSensitive) {
    let index = (0, tag_utils_1.findInlineTagIndex)(excerpt, tag, caseSensitive);
    let matched = `#${tag}`;
    if (index < 0) {
        index = findTextIndex(excerpt, tag, caseSensitive);
        matched = tag;
    }
    if (index < 0) {
        parent.appendText(excerpt);
        return;
    }
    parent.appendText(excerpt.slice(0, index));
    parent.createEl("mark", { text: excerpt.slice(index, index + matched.length), cls: "tra-highlight" });
    parent.appendText(excerpt.slice(index + matched.length));
}
function findTextIndex(text, needle, caseSensitive) {
    return caseSensitive
        ? text.indexOf(needle)
        : text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
}
function pluralRu(count, one, few, many) {
    const abs = Math.abs(count) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20)
        return many;
    if (last > 1 && last < 5)
        return few;
    if (last === 1)
        return one;
    return many;
}
function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1)
        return "только что";
    if (minutes < 60)
        return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} д назад`;
}
function clampNumber(value, min, max, fallback) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}


/* ===== scanner.js ===== */
function isIgnoredPath(path, ignoredFolders) {
    const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return ignoredFolders.some((folder) => {
        const normalizedFolder = folder.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
        return normalizedFolder.length > 0 &&
            (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
    });
}
function scanTagIndex(app, settings) {
    const result = new Map();
    const files = app.vault.getMarkdownFiles()
        .filter((file) => !isIgnoredPath(file.path, settings.ignoredFolders))
        .sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache)
            continue;
        // Keep one canonical tag per identity in each note. In case-insensitive
        // mode #Project and #project in one file must still count as one occurrence.
        const tagsInFile = new Map();
        for (const cachedTag of cache.tags ?? []) {
            const normalized = (0, tag_utils_1.normalizeTag)(cachedTag.tag);
            if (normalized) {
                const key = (0, tag_utils_1.tagKey)(normalized, settings.caseSensitive);
                if (!tagsInFile.has(key))
                    tagsInFile.set(key, normalized);
            }
        }
        for (const frontmatterTag of (0, tag_utils_1.collectFrontmatterTags)(cache.frontmatter)) {
            const key = (0, tag_utils_1.tagKey)(frontmatterTag, settings.caseSensitive);
            if (!tagsInFile.has(key))
                tagsInFile.set(key, frontmatterTag);
        }
        for (const [key, tag] of tagsInFile) {
            let info = result.get(key);
            if (!info) {
                info = { tag, key, files: [] };
                result.set(key, info);
            }
            info.files.push(file);
        }
    }
    return new Map([...result.entries()].sort(([, a], [, b]) => a.tag.localeCompare(b.tag, undefined, {
        sensitivity: settings.caseSensitive ? "variant" : "base",
        numeric: true,
    })));
}
function tagCountForFiles(index) {
    let total = 0;
    for (const info of index.values())
        total += info.files.length;
    return total;
}
function filesAffectedByTags(index, tags, caseSensitive) {
    const files = new Map();
    for (const tag of tags) {
        const info = index.get((0, tag_utils_1.tagKey)(tag, caseSensitive));
        if (!info)
            continue;
        for (const file of info.files)
            files.set(file.path, file);
    }
    return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}


/* ===== modals.js ===== */
class ApplyConfirmModal extends obsidian_1.Modal {
    constructor(app, changes, affectedCount, mergedTargets, onConfirm) {
        super(app);
        this.changes = changes;
        this.affectedCount = affectedCount;
        this.mergedTargets = mergedTargets;
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-modal-icon" });
        (0, obsidian_1.setIcon)(icon, "shield-check");
        contentEl.createEl("h2", { text: "Применить изменения?" });
        const renameCount = this.changes.filter((change) => change.action === "rename").length;
        const deleteCount = this.changes.filter((change) => change.action === "delete" || change.newTag === null).length;
        const unmarkCount = this.changes.filter((change) => change.action === "unmark").length;
        const actionSummary = [
            renameCount ? `${renameCount} ${(0, utils_1.pluralRu)(renameCount, "переименование", "переименования", "переименований")}` : "",
            deleteCount ? `${deleteCount} ${(0, utils_1.pluralRu)(deleteCount, "удаление тега", "удаления тега", "удалений тегов")}` : "",
            unmarkCount ? `${unmarkCount} ${(0, utils_1.pluralRu)(unmarkCount, "снятие маркировки", "снятия маркировки", "снятий маркировки")}` : "",
        ].filter(Boolean).join(", ");
        contentEl.createEl("p", { text: `Будет обработано ${this.affectedCount} ${(0, utils_1.pluralRu)(this.affectedCount, "заметка", "заметки", "заметок")}. ${actionSummary ? `В очереди: ${actionSummary}.` : ""}` });
        const changes = contentEl.createDiv({ cls: "tra-modal-changes" });
        for (const change of this.changes) {
            const row = changes.createDiv({ cls: "tra-modal-change" });
            row.createSpan({ text: `#${change.oldTag}` });
            if (change.action === "delete" || change.newTag === null) {
                const remove = row.createSpan({ cls: "tra-modal-delete" });
                (0, obsidian_1.setIcon)(remove, "trash-2");
                row.createSpan({ text: "Удалить тег" });
            }
            else if (change.action === "unmark") {
                const unmark = row.createSpan({ cls: "tra-modal-unmark" });
                (0, obsidian_1.setIcon)(unmark, "hash");
                row.createSpan({ text: "Убрать #, оставить текст" });
            }
            else {
                const arrow = row.createSpan({ cls: "tra-modal-arrow" });
                (0, obsidian_1.setIcon)(arrow, "arrow-right");
                row.createSpan({ text: `#${change.newTag}` });
            }
        }
        if (this.mergedTargets.length > 0) {
            const warning = contentEl.createDiv({ cls: "tra-modal-warning" });
            const warningIcon = warning.createDiv();
            (0, obsidian_1.setIcon)(warningIcon, "alert-triangle");
            const warningText = warning.createDiv();
            warningText.createEl("strong", { text: "Возможное объединение тегов" });
            warningText.createEl("p", { text: `Следующие целевые теги уже существуют или повторяются в очереди: ${this.mergedTargets.map((tag) => `#${tag}`).join(", ")}. Это объединит их статистику.` });
        }
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        const cancel = actions.createEl("button", { cls: "tra-secondary-button", text: "Отмена" });
        cancel.addEventListener("click", () => this.close());
        const confirm = actions.createEl("button", { cls: "tra-primary-button", text: "Применить изменения" });
        confirm.addEventListener("click", async () => {
            confirm.disabled = true;
            confirm.setText("Обработка…");
            try {
                await this.onConfirm();
                this.close();
            }
            catch (error) {
                new obsidian_1.Notice(`Не удалось применить изменения: ${error instanceof Error ? error.message : String(error)}`, 8000);
                confirm.disabled = false;
                confirm.setText("Повторить");
            }
        });
    }
    onClose() {
        this.contentEl.empty();
    }
}
class BatchReportModal extends obsidian_1.Modal {
    constructor(app, plugin, report, isUndoReport = false) {
        super(app);
        this.plugin = plugin;
        this.report = report;
        this.isUndoReport = isUndoReport;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-report-icon" });
        (0, obsidian_1.setIcon)(icon, this.isUndoReport ? "history" : this.report.errors.length > 0 ? "alert-circle" : "check-circle-2");
        contentEl.createEl("h2", { text: this.isUndoReport ? "Отмена завершена" : "Результат рефакторинга" });
        const stats = contentEl.createDiv({ cls: "tra-report-stats" });
        this.createReportStat(stats, "Изменено", String(this.report.updatedFiles), "check");
        this.createReportStat(stats, this.isUndoReport ? "Пропущено" : "Без изменений", String(this.report.unchangedFiles), "minus");
        this.createReportStat(stats, "Ошибки", String(this.report.errors.length), "alert-triangle");
        if (!this.isUndoReport && this.report.mergedTargets.length > 0) {
            contentEl.createEl("p", { cls: "tra-report-note", text: `Объединённые цели: ${this.report.mergedTargets.map((tag) => `#${tag}`).join(", ")}` });
        }
        if (this.report.errors.length > 0) {
            const errorList = contentEl.createDiv({ cls: "tra-error-list" });
            errorList.createEl("strong", { text: "Файлы с ошибками" });
            for (const error of this.report.errors)
                errorList.createEl("div", { text: error });
        }
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        if (!this.isUndoReport && this.plugin.lastUndo.size > 0) {
            const undo = actions.createEl("button", { cls: "tra-secondary-button", text: "Отменить операцию" });
            undo.addEventListener("click", () => {
                this.close();
                void this.plugin.undoLastBatch();
            });
        }
        const close = actions.createEl("button", { cls: "tra-primary-button", text: "Готово" });
        close.addEventListener("click", () => this.close());
    }
    createReportStat(parent, label, value, iconName) {
        const item = parent.createDiv({ cls: "tra-report-stat" });
        const icon = item.createDiv();
        (0, obsidian_1.setIcon)(icon, iconName);
        item.createDiv({ cls: "tra-report-value", text: value });
        item.createDiv({ cls: "tra-report-label", text: label });
    }
    onClose() {
        this.contentEl.empty();
    }
}


/* ===== settings.js ===== */
class TagAuditorSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Tag Refactor & Auditor" });
        containerEl.createEl("p", { text: "Настройки сканирования и предпросмотра тегов." });
        new obsidian_1.Setting(containerEl)
            .setName("Длина предпросмотра")
            .setDesc("Количество символов в выдержке заметки.")
            .addText((text) => text
            .setPlaceholder("400")
            .setValue(String(this.plugin.settings.previewChars))
            .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed))
                return;
            this.plugin.settings.previewChars = (0, utils_1.clampNumber)(parsed, 80, 1200, 400);
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("YAML-атрибут даты создания заметки")
            .setDesc("Имя поля YAML, например created или Дата. Поддерживаются ISO, числовые даты и названия месяцев на разных языках (например, 12 октября 2012). Если поле указано, заметки без корректной даты идут в конец; если поле пустое, используется дата создания файла.")
            .addText((text) => text
            .setPlaceholder("created")
            .setValue(this.plugin.settings.createdDateProperty)
            .onChange(async (value) => {
            this.plugin.settings.createdDateProperty = value.trim();
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Учитывать регистр")
            .setDesc("При включении #Project и #project считаются разными тегами.")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.caseSensitive)
            .onChange(async (value) => {
            this.plugin.settings.caseSensitive = value;
            await this.plugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Игнорируемые папки")
            .setDesc("Пути относительно корня хранилища, по одному на строку. В эти папки плагин не будет заходить при сканировании.")
            .addTextArea((text) => {
            text
                .setPlaceholder("Templates\nArchive")
                .setValue(this.plugin.settings.ignoredFolders.join("\n"));
            text.inputEl.rows = 5;
            text.inputEl.addClass("tra-settings-textarea");
            text.onChange(async (value) => {
                this.plugin.settings.ignoredFolders = value
                    .split(/\r?\n/)
                    .map((path) => path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
                    .filter(Boolean);
                await this.plugin.saveSettings();
            });
        });
        containerEl.createEl("p", {
            cls: "tra-settings-note",
            text: "Пакетное применение сохраняет формат YAML и кодовые блоки. Последнюю операцию можно отменить, если файлы после неё не менялись.",
        });
    }
}


/* ===== view.js ===== */
const DATE_MONTH_ALIASES = new Map();
const DATE_MONTH_GROUPS = [
    // January / Janvier / Enero / Gennaio and related forms.
    ["january|jan|janvier|janv|enero|ene|janeiro|jane|gennaio|gen|januari|januar|ianuarie|styczeń|stycznia|stycz|leden|ledna|tammikuu|tammikuuta|январь|января|январе|янв|січень|січня|січ|студзень|студзеня|Ιανουάριος|Ιανουαρίου|يناير|มกราคม"],
    ["february|feb|février|fevrier|févr|fevr|febrero|feb|fevereiro|fev|febbraio|feb|februari|februar|februarie|luty|lutego|lut|únor|unor|února|unora|helmikuu|helmikuuta|февраль|февраля|феврале|фев|лютий|лютого|лют|люты|лютага|Φεβρουάριος|Φεβρουαρίου|فبراير|กุมภาพันธ์"],
    ["march|mar|mars|marzo|março|marco|maret|maart|märz|marz|marzec|marca|březen|brezen|března|brezna|maaliskuu|maaliskuuta|березень|березня|март|марта|марте|мар|сакавік|сакавіка|Μάρτιος|Μαρτίου|مارس|มีนาคม"],
    ["april|apr|avril|avr|abril|abr|aprile|kwiecień|kwiecien|kwietnia|kwie|duben|dubna|huhtikuu|huhtikuuta|апрель|апреля|апреле|апр|квітень|квітня|красавік|красавіка|nisan|Απρίλιος|Απριλίου|أبريل|ابريل|เมษายน"],
    ["may|mai|mayo|maio|maggio|mei|maj|maja|květen|kveten|května|kvetna|toukokuu|toukokuuta|травень|травня|май|мая|мае|mayıs|mayis|Μάιος|Μαΐου|مايو|พฤษภาคม"],
    ["june|jun|juin|juin|junio|junho|giugno|giu|juni|czerwiec|czerwca|cze|červen|cerven|června|cervna|kesäkuu|kesäkuuta|червень|червня|июнь|июня|июне|июн|haziran|Ιούνιος|Ιουνίου|يونيو|มิถุนายน"],
    ["july|jul|juillet|juil|julio|julho|luglio|lug|juli|lipiec|lipca|lip|červenec|cervenec|července|cervence|heinäkuu|heinäkuuta|липень|липня|июль|июля|июле|июл|temmuz|Ιούλιος|Ιουλίου|يوليو|กรกฎาคม"],
    ["august|aug|août|aout|agosto|ag|augustus|augustus|sierpień|sierpien|sierpnia|sie|srpen|srpna|elokuu|elokuuta|серпень|серпня|август|августа|августе|авг|ağustos|agustos|Αύγουστος|Αυγούστου|أغسطس|اغسطس|สิงหาคม"],
    ["september|sep|sept|septembre|septiembre|setiembre|set|setembro|settembre|wrzesień|wrzesien|września|wrzesnia|wrz|září|zari|syyskuu|syyskuuta|вересень|вересня|сентябрь|сентября|сентябре|сен|сент|eylül|eylul|Σεπτέμβριος|Σεπτεμβρίου|سبتمبر|กันยายน"],
    ["october|oct|octobre|oct|octubre|outubro|out|ottobre|oktober|okt|październik|pazdziernik|października|pazdziernika|paź|paz|říjen|rijen|října|rijna|lokakuu|lokakuuta|жовтень|жовтня|октябрь|октября|октябре|окт|ekim|Οκτώβριος|Οκτωβρίου|أكتوبر|اكتوبر|ตุลาคม"],
    ["november|nov|novembre|noviembre|novembro|nov|listopad|listopada|listopadu|lis|marraskuu|marraskuuta|листопад|листопада|ноябрь|ноября|ноябре|ноя|kasım|kasim|Νοέμβριος|Νοεμβρίου|نوفمبر|พฤศจิกายน"],
    ["december|dec|décembre|decembre|diciembre|dezembro|dez|dicembre|dic|december|dezember|dez|grudzień|grudzien|grudnia|gru|prosinec|prosince|joulukuu|joulukuuta|грудень|грудня|декабрь|декабря|декабре|дек|aralık|aralik|Δεκέμβριος|Δεκεμβρίου|ديسمبر|ธันวาคม"],
];
function normalizeDateToken(value) {
    return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.'’ʼ]/g, "").trim();
}
for (let monthIndex = 0; monthIndex < DATE_MONTH_GROUPS.length; monthIndex += 1) {
    for (const alias of DATE_MONTH_GROUPS[monthIndex][0].split("|")) {
        DATE_MONTH_ALIASES.set(normalizeDateToken(alias), monthIndex + 1);
    }
}
const THAI_MONTH_ALIASES = new Set(["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"].map(normalizeDateToken));
function normalizeLocalizedDigits(value) {
    return value.replace(/[٠-٩۰-۹]/g, (digit) => {
        const code = digit.codePointAt(0) ?? 0;
        const base = code >= 0x06f0 && code <= 0x06f9 ? 0x06f0 : 0x0660;
        return String(code - base);
    }).replace(/[۰-۹]/g, (digit) => String((digit.codePointAt(0) ?? 0) - 0x06f0));
}
function toUtcDateTimestamp(year, month, day) {
    if (!Number.isInteger(year) || year < 100 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31)
        return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
        return null;
    return date.getTime();
}
function expandTwoDigitYear(year) {
    if (year >= 100)
        return year;
    return year <= 49 ? 2000 + year : 1900 + year;
}
function parseCreationDate(value) {
    if (value instanceof Date)
        return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            return 0;
        if (Number.isInteger(value) && value >= 19000101 && value <= 29991231) {
            const raw = String(value);
            return toUtcDateTimestamp(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8))) ?? 0;
        }
        if (Math.abs(value) >= 1000000000000)
            return value;
        if (Math.abs(value) >= 1000000000)
            return value * 1000;
        return 0;
    }
    if (typeof value !== "string")
        return 0;
    let raw = normalizeLocalizedDigits(value).trim().replace(/[\u200e\u200f\u202a-\u202e]/g, "");
    if (!raw)
        return 0;
    raw = raw.replace(/^['"]|['"]$/g, "").trim();
    // ISO date/timestamp: deterministic across machines and locales.
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[Tt\s])/);
    if (iso) {
        const calendar = toUtcDateTimestamp(Number(iso[1]), Number(iso[2]), Number(iso[3]));
        if (calendar === null)
            return 0;
        const parsedTimestamp = Date.parse(raw);
        return Number.isFinite(parsedTimestamp) ? parsedTimestamp : calendar;
    }
    // Compact YYYYMMDD and year-first separated dates (YYYY/MM/DD, YYYY.MM.DD).
    if (/^\d{8}$/.test(raw)) {
        return toUtcDateTimestamp(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8))) ?? 0;
    }
    const ymd = raw.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})(?=$|[Tt\s])/);
    if (ymd) {
        return toUtcDateTimestamp(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])) ?? 0;
    }
    // East Asian year/month/day forms, such as 2012年10月12日 or 2012년 10월 12일.
    const eastAsian = raw.match(/^\s*(\d{4})\s*(?:年|년)\s*(\d{1,2})\s*(?:月|월)\s*(\d{1,2})\s*(?:日|일)?/);
    if (eastAsian) {
        return toUtcDateTimestamp(Number(eastAsian[1]), Number(eastAsian[2]), Number(eastAsian[3])) ?? 0;
    }
    // Numeric dates: dotted/hyphenated forms default to day-first; slash forms
    // default to month-first when both first components are <= 12 (common US style).
    const numeric = raw.match(/^\s*(\d{1,2})\s*([/.\-])\s*(\d{1,2})\s*\2\s*(\d{2,4})(?=$|[\s,Tt])/);
    if (numeric) {
        const first = Number(numeric[1]);
        const second = Number(numeric[3]);
        const year = expandTwoDigitYear(Number(numeric[4]));
        let month;
        let day;
        if (first > 12) {
            day = first;
            month = second;
        }
        else if (second > 12) {
            month = first;
            day = second;
        }
        else if (numeric[2] === "/") {
            month = first;
            day = second;
        }
        else {
            day = first;
            month = second;
        }
        return toUtcDateTimestamp(year, month, day) ?? 0;
    }
    // Textual month formats used across many locales: 12 октября 2012,
    // October 12, 2012, 12 octobre 2012, 12 de outubro de 2012, etc.
    // Drop a trailing time before extracting date components.
    const datePart = raw.replace(/[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?\s*$/i, "").trim();
    let month = 0;
    let thaiCalendar = false;
    for (const token of datePart.match(/[\p{L}\p{M}]+/gu) ?? []) {
        const normalizedToken = normalizeDateToken(token);
        const found = DATE_MONTH_ALIASES.get(normalizedToken);
        if (found) {
            month = found;
            thaiCalendar = THAI_MONTH_ALIASES.has(normalizedToken);
            break;
        }
    }
    if (month) {
        const numbers = [...datePart.matchAll(/\d{1,4}/g)].map((match) => ({ value: Number(match[0]), length: match[0].length }));
        if (numbers.length >= 2) {
            let yearEntry = numbers.find((item) => item.value >= 1000 && item.value <= 9999);
            if (!yearEntry) {
                const possibleYear = [...numbers].reverse().find((item) => item.length === 2 && item.value <= 99);
                if (possibleYear)
                    yearEntry = possibleYear;
            }
            if (yearEntry) {
                let year = expandTwoDigitYear(yearEntry.value);
                if (thaiCalendar && year >= 2400 && year <= 2700)
                    year -= 543;
                const dayEntry = numbers.find((item) => item !== yearEntry && item.value >= 1 && item.value <= 31);
                if (dayEntry) {
                    const parsed = toUtcDateTimestamp(year, month, dayEntry.value);
                    return parsed ?? 0;
                }
            }
        }
        return 0;
    }
    // Final fallback supports RFC-style strings and other formats understood by
    // the JavaScript engine; all common ambiguous formats above are handled first.
    const fallback = Date.parse(raw);
    return Number.isFinite(fallback) ? fallback : 0;
}

function getFrontmatterProperty(frontmatter, property) {
    if (!frontmatter || typeof frontmatter !== "object")
        return undefined;
    if (Object.prototype.hasOwnProperty.call(frontmatter, property))
        return frontmatter[property];
    return property.split(".").reduce((current, part) => {
        if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, part))
            return current[part];
        return undefined;
    }, frontmatter);
}
class TagAuditorView extends obsidian_1.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.selectedTag = null;
        this.query = "";
        this.showAllPreviews = false;
        this.tagListScrollTop = 0;
        this.sortMode = "name";
        this.plugin = plugin;
    }
    getViewType() {
        return constants_1.VIEW_TYPE;
    }
    getDisplayText() {
        return "Tag Refactor & Auditor";
    }
    getIcon() {
        return "tags";
    }
    async onOpen() {
        this.render();
    }
    async onClose() {
        // No persistent listeners are attached by this view.
    }
    render() {
        const root = this.contentEl;
        // Keep the tag catalog at its current scroll position when selecting a tag
        // causes the whole view to be rebuilt.
        const previousTagList = root.querySelector(".tra-tag-list");
        const previousTagListScrollTop = previousTagList?.scrollTop ?? this.tagListScrollTop ?? 0;
        this.tagListScrollTop = previousTagListScrollTop;
        root.empty();
        root.addClass("tra-view");
        const shell = root.createDiv({ cls: "tra-shell" });

        const header = shell.createDiv({ cls: "tra-header" });
        const titleGroup = header.createDiv({ cls: "tra-title-group" });
        const iconWrap = titleGroup.createDiv({ cls: "tra-title-icon" });
        (0, obsidian_1.setIcon)(iconWrap, "tags");
        const heading = titleGroup.createDiv({ cls: "tra-heading" });
        heading.createEl("h2", { text: "Tag Refactor" });
        heading.createEl("p", { text: "Аудит и переименование тегов" });
        const scanButton = header.createEl("button", { cls: "tra-icon-button", attr: { "aria-label": "Сканировать теги", title: "Сканировать теги" } });
        (0, obsidian_1.setIcon)(scanButton, "refresh-cw");
        scanButton.addEventListener("click", () => {
            void this.plugin.scanTags().then(() => new obsidian_1.Notice("Сканирование тегов завершено."));
        });

        const overview = shell.createDiv({ cls: "tra-overview" });
        this.createStat(overview, "Теги", String(this.plugin.tagIndex.size), "hash");
        this.createStat(overview, "Заметки", String(this.plugin.app.vault.getMarkdownFiles().length), "files");
        this.createStat(overview, "В очереди", String(this.plugin.pendingChanges.size), "git-pull-request");

        const workspace = shell.createDiv({ cls: "tra-bento-grid" });
        const tagBrowser = workspace.createDiv({ cls: "tra-tag-browser-card" });
        const searchWrap = tagBrowser.createDiv({ cls: "tra-search-wrap" });
        const searchIcon = searchWrap.createDiv({ cls: "tra-search-icon" });
        (0, obsidian_1.setIcon)(searchIcon, "search");
        const search = searchWrap.createEl("input", {
            cls: "tra-search",
            attr: { type: "search", placeholder: "Найти тег…", "aria-label": "Поиск тегов" },
        });
        search.value = this.query;

        const listHeader = tagBrowser.createDiv({ cls: "tra-section-heading" });
        listHeader.createEl("span", { text: "Теги" });
        const tagTotal = listHeader.createSpan({ cls: "tra-tag-total", text: String(this.plugin.tagIndex.size) });

        const sortControl = tagBrowser.createDiv({ cls: "tra-sort-control" });
        const sortLabel = sortControl.createEl("label", { cls: "tra-sort-label", text: "Сортировка тегов" });
        const sortSelect = sortControl.createEl("select", {
            cls: "tra-sort-select",
            attr: {
                "aria-label": "Сортировка тегов",
                title: "Сортировка по самой поздней дате создания заметки с тегом. Источник даты задаётся в настройках.",
            },
        });
        sortLabel.setAttr("for", sortSelect.id = `tra-sort-${Math.random().toString(36).slice(2, 9)}`);
        const sortOptions = [
            ["name", "По названию"],
            ["recent", "По дате создания заметки"],
            ["count", "По количеству заметок"],
        ];
        for (const [value, label] of sortOptions)
            sortSelect.createEl("option", { text: label, attr: { value } });
        sortSelect.value = this.sortMode;

        const mentionFilter = tagBrowser.createDiv({ cls: "tra-mention-filter" });
        const mentionLabel = mentionFilter.createEl("label", {
            cls: "tra-sort-label",
            text: "Порог упоминаний (число заметок)",
        });
        const mentionInput = mentionFilter.createEl("input", {
            cls: "tra-threshold-input",
            attr: {
                type: "number",
                min: "0",
                step: "1",
                placeholder: "0",
                title: "Пусто или 0 — показывать все теги",
                "aria-label": "Минимальное число заметок с тегом",
            },
        });
        mentionInput.value = String(this.plugin.settings.minTagMentions ?? 0);
        mentionLabel.setAttr("for", mentionInput.id = `tra-min-mentions-${Math.random().toString(36).slice(2, 9)}`);

        const list = tagBrowser.createDiv({ cls: "tra-tag-list" });
        const renderList = () => {
            tagTotal.setText(String(this.renderTagRows(list, search.value)));
        };
        list.addEventListener("scroll", () => {
            this.tagListScrollTop = list.scrollTop;
        }, { passive: true });
        search.addEventListener("input", () => {
            this.query = search.value;
            renderList();
        });
        sortSelect.addEventListener("change", () => {
            this.sortMode = sortSelect.value;
            renderList();
        });
        mentionInput.addEventListener("input", () => {
            const raw = mentionInput.value.trim();
            const parsed = raw === "" ? 0 : Number.parseInt(raw, 10);
            this.plugin.settings.minTagMentions = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            renderList();
            void this.plugin.saveData(this.plugin.settings);
        });
        renderList();
        // Restore after layout has been recalculated. The animation-frame restore
        // avoids browsers resetting scrollTop while the new tag rows are measured.
        list.scrollTop = previousTagListScrollTop;
        window.requestAnimationFrame(() => {
            if (list.isConnected) {
                list.scrollTop = previousTagListScrollTop;
            }
        });

        // Bento layout: tag browser occupies the left column; preview and queue
        // are separate cards in the right column.
        this.renderSelectedTag(workspace);
        this.renderPendingChanges(workspace);

        const footer = shell.createDiv({ cls: "tra-footer" });
        footer.createSpan({ text: this.plugin.lastScanTime ? `Синхронизировано · ${(0, utils_1.relativeTime)(this.plugin.lastScanTime)}` : "Ожидание индекса" });
        const settingsButton = footer.createEl("button", { cls: "tra-text-button", text: "Настройки" });
        settingsButton.addEventListener("click", () => {
            // The settings tab is opened using Obsidian's built-in settings pane.
            // @ts-expect-error Obsidian exposes this method at runtime; it is not in all typings.
            this.plugin.app.setting?.open();
            // @ts-expect-error plugin id is supported by Obsidian's settings pane.
            this.plugin.app.setting?.openTabById?.(this.plugin.manifest.id);
        });
    }
    createStat(parent, label, value, iconName) {
        const stat = parent.createDiv({ cls: "tra-stat" });
        const icon = stat.createDiv({ cls: "tra-stat-icon" });
        (0, obsidian_1.setIcon)(icon, iconName);
        stat.createDiv({ cls: "tra-stat-label", text: label });
        stat.createDiv({ cls: "tra-stat-value", text: value });
    }
    getNoteCreationTimestamp(file) {
        const property = (this.plugin.settings.createdDateProperty ?? "").trim();
        if (!property)
            return file.stat?.ctime ?? 0;
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        return parseCreationDate(getFrontmatterProperty(frontmatter, property));
    }
    renderTagRows(parent, query) {
        parent.empty();
        const normalizedQuery = query.trim().replace(/^#/, "").toLocaleLowerCase();
        const configuredThreshold = Number(this.plugin.settings.minTagMentions ?? 0);
        const threshold = Number.isFinite(configuredThreshold) ? Math.max(0, Math.floor(configuredThreshold)) : 0;
        const entries = [...this.plugin.tagIndex.values()].filter((info) => info.files.length >= threshold && info.tag.toLocaleLowerCase().includes(normalizedQuery));
        const compareByName = (a, b) => a.tag.localeCompare(b.tag, undefined, {
            sensitivity: this.plugin.settings.caseSensitive ? "variant" : "base",
            numeric: true,
        });
        // Sort each tag by the newest creation date among notes containing it.
        // Date source: configured YAML property, or file ctime when the setting is empty.
        const latestTimes = new Map(entries.map((info) => [
            info.key,
            info.files.reduce((latest, file) => Math.max(latest, this.getNoteCreationTimestamp(file)), 0),
        ]));
        entries.sort((a, b) => {
            if (this.sortMode === "count")
                return b.files.length - a.files.length || compareByName(a, b);
            if (this.sortMode === "recent")
                return (latestTimes.get(b.key) ?? 0) - (latestTimes.get(a.key) ?? 0) || compareByName(a, b);
            return compareByName(a, b);
        });
        if (entries.length === 0) {
            const empty = parent.createDiv({ cls: "tra-empty" });
            const icon = empty.createDiv({ cls: "tra-empty-icon" });
            (0, obsidian_1.setIcon)(icon, normalizedQuery ? "search-x" : "tags");
            empty.createEl("p", { text: normalizedQuery || threshold > 0 ? "Ничего не найдено" : "Теги не найдены" });
            empty.createEl("span", { text: normalizedQuery || threshold > 0 ? "Измените поиск или уменьшите порог упоминаний." : "После сканирования здесь появятся теги из заметок." });
            return 0;
        }
        for (const info of entries) {
            const isSelected = this.selectedTag !== null && (0, tag_utils_1.tagKey)(this.selectedTag, this.plugin.settings.caseSensitive) === info.key;
            const isPending = this.plugin.pendingChanges.has(info.key);
            const row = parent.createEl("button", {
                cls: `tra-tag-row${isSelected ? " is-selected" : ""}${isPending ? " is-pending" : ""}`,
                attr: { type: "button" },
            });
            const hash = row.createSpan({ cls: "tra-tag-hash", text: "#" });
            hash.setAttr("aria-hidden", "true");
            row.createSpan({ cls: "tra-tag-name", text: info.tag });
            if (isPending) {
                const pendingMark = row.createSpan({ cls: "tra-pending-dot" });
                pendingMark.setAttr("aria-label", "На изменение");
            }
            row.createSpan({ cls: "tra-tag-count", text: String(info.files.length) });
            row.addEventListener("click", () => {
                this.selectedTag = info.tag;
                this.showAllPreviews = false;
                this.render();
            });
        }
        return entries.length;
    }
    renderSelectedTag(root) {
        if (!this.selectedTag) {
            const tip = root.createDiv({ cls: "tra-select-prompt" });
            const icon = tip.createDiv({ cls: "tra-select-icon" });
            (0, obsidian_1.setIcon)(icon, "mouse-pointer-click");
            tip.createEl("strong", { text: "Выберите тег" });
            tip.createEl("p", { text: "Посмотрите, где он используется, и добавьте переименование в очередь." });
            return;
        }
        const info = this.plugin.getTagInfo(this.selectedTag);
        if (!info) {
            this.selectedTag = null;
            return;
        }
        const card = root.createDiv({ cls: "tra-selected-card" });
        const selectedHeader = card.createDiv({ cls: "tra-selected-header" });
        const selectedTitle = selectedHeader.createDiv({ cls: "tra-selected-title" });
        selectedTitle.createEl("span", { cls: "tra-tag-hash", text: "#" });
        selectedTitle.createEl("h3", { text: info.tag });
        selectedHeader.createEl("span", { cls: "tra-count-pill", text: `${info.files.length} ${(0, utils_1.pluralRu)(info.files.length, "заметка", "заметки", "заметок")}` });
        const form = card.createDiv({ cls: "tra-rename-form" });
        const label = form.createEl("label", { text: "Новое имя тега", cls: "tra-field-label" });
        const fieldRow = form.createDiv({ cls: "tra-field-row" });
        const hashPrefix = fieldRow.createSpan({ cls: "tra-input-prefix", text: "#" });
        hashPrefix.setAttr("aria-hidden", "true");
        const input = fieldRow.createEl("input", {
            cls: "tra-rename-input",
            attr: { type: "text", placeholder: "новый-тег", autocomplete: "off", spellcheck: "false" },
        });
        label.setAttr("for", input.id = `tra-rename-${Math.random().toString(36).slice(2, 9)}`);
        const addButton = fieldRow.createEl("button", { cls: "tra-primary-button tra-add-button", text: "В очередь" });
        addButton.type = "button";
        const warning = form.createDiv({ cls: "tra-inline-warning" });
        const destructiveActions = form.createDiv({ cls: "tra-destructive-actions" });
        const deleteButton = destructiveActions.createEl("button", {
            cls: "tra-danger-button",
            attr: { type: "button", title: `Добавить удаление #${info.tag} в очередь` },
        });
        const deleteIcon = deleteButton.createSpan({ cls: "tra-button-icon" });
        (0, obsidian_1.setIcon)(deleteIcon, "trash-2");
        deleteButton.createSpan({ text: "Удалить тег из всех заметок" });
        const unmarkButton = destructiveActions.createEl("button", {
            cls: "tra-secondary-button tra-unmark-button",
            attr: { type: "button", title: `Убрать # у #${info.tag}, сохранив текст` },
        });
        const unmarkIcon = unmarkButton.createSpan({ cls: "tra-button-icon" });
        (0, obsidian_1.setIcon)(unmarkIcon, "hash");
        unmarkButton.createSpan({ text: "Убрать #, оставить текст" });
        destructiveActions.createEl("small", { text: "В тексте #тег станет обычным словом; запись из YAML tags/tag будет удалена из метаданных." });
        deleteButton.addEventListener("click", () => this.plugin.addDeleteTagChange(info.tag));
        unmarkButton.addEventListener("click", () => this.plugin.addUnmarkTagChange(info.tag));
        const updateWarning = () => {
            const value = (0, tag_utils_1.cleanTagInput)(input.value);
            warning.empty();
            if (!value)
                return;
            if (!(0, tag_utils_1.isValidTag)(value)) {
                warning.setText("Используйте буквы, цифры, `_`, `-` и `/`.");
                warning.addClass("is-error");
                return;
            }
            warning.removeClass("is-error");
            const target = this.plugin.getTagInfo(value);
            if (target && (0, tag_utils_1.tagKey)(value, this.plugin.settings.caseSensitive) !== info.key) {
                warning.setText(`#${value} уже существует. Теги будут объединены.`);
                warning.addClass("is-warning");
            }
        };
        input.addEventListener("input", updateWarning);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                addButton.click();
            }
        });
        addButton.addEventListener("click", () => {
            const target = (0, tag_utils_1.cleanTagInput)(input.value);
            if (this.plugin.addOrUpdateChange(info.tag, target)) {
                this.selectedTag = info.tag;
                this.render();
            }
        });
        const previewHeader = card.createDiv({ cls: "tra-preview-header" });
        const previewTitle = previewHeader.createDiv({ cls: "tra-preview-title" });
        (0, obsidian_1.setIcon)(previewTitle.createSpan({ cls: "tra-preview-icon" }), "files");
        previewTitle.createEl("span", { text: "В заметках" });
        previewHeader.createSpan({ cls: "tra-muted", text: "Предпросмотр" });
        const previews = card.createDiv({ cls: "tra-preview-list" });
        void this.renderPreviews(previews, info);
    }
    async renderPreviews(parent, info) {
        const files = info.files;
        const limit = this.showAllPreviews ? files.length : Math.min(files.length, 8);
        for (const file of files.slice(0, limit)) {
            const item = parent.createDiv({
                cls: "tra-file-card is-clickable",
                attr: { role: "button", tabindex: "0", "aria-label": `Открыть заметку ${file.basename} в новой вкладке` },
            });
            const openInNewTab = () => {
                void this.plugin.app.workspace.getLeaf("tab").openFile(file);
            };
            item.addEventListener("click", openInNewTab);
            item.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openInNewTab();
                }
            });
            const titleRow = item.createDiv({ cls: "tra-file-title-row" });
            const docIcon = titleRow.createDiv({ cls: "tra-file-icon" });
            (0, obsidian_1.setIcon)(docIcon, "file-text");
            const link = titleRow.createSpan({ cls: "tra-file-link", text: file.basename });
            link.setAttr("title", file.path);
            const path = item.createDiv({ cls: "tra-file-path", text: file.path });
            try {
                const raw = await this.plugin.app.vault.cachedRead(file);
                const withoutFrontmatter = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
                const tagIndex = (0, tag_utils_1.findInlineTagIndex)(withoutFrontmatter, info.tag, this.plugin.settings.caseSensitive);
                const plainIndex = tagIndex >= 0 ? tagIndex : (0, utils_1.findTextIndex)(withoutFrontmatter, info.tag, this.plugin.settings.caseSensitive);
                const maxChars = this.plugin.settings.previewChars;
                const start = plainIndex >= 0 ? Math.max(0, plainIndex - Math.floor(maxChars * 0.28)) : 0;
                const excerpt = withoutFrontmatter.slice(start, start + maxChars);
                const excerptEl = item.createDiv({ cls: "tra-excerpt markdown-rendered" });
                const renderedExcerpt = `${start > 0 ? "…\n\n" : ""}${excerpt}${start + maxChars < withoutFrontmatter.length ? "\n\n…" : ""}`;
                // Render the snippet with Obsidian's Markdown engine, so headings,
                // lists, emphasis, links, tables, and other Markdown syntax appear as layout.
                await obsidian_1.MarkdownRenderer.render(this.plugin.app, renderedExcerpt, excerptEl, file.path, this);
                this.highlightRenderedTag(excerptEl, info.tag);
            }
            catch {
                item.createDiv({ cls: "tra-excerpt tra-muted", text: "Не удалось прочитать заметку." });
            }
            // Keep the path available to screen readers even when the title is short.
            path.setAttr("aria-label", file.path);
        }
        if (files.length > limit) {
            const more = parent.createEl("button", {
                cls: "tra-show-more",
                text: `Показать ещё ${files.length - limit}`,
                attr: { type: "button" },
            });
            more.addEventListener("click", () => {
                this.showAllPreviews = true;
                this.render();
            });
        }
        else if (this.showAllPreviews && files.length > 8) {
            const less = parent.createEl("button", { cls: "tra-show-more", text: "Свернуть список", attr: { type: "button" } });
            less.addEventListener("click", () => {
                this.showAllPreviews = false;
                this.render();
            });
        }
    }
    highlightRenderedTag(container, tag) {
        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const flags = this.plugin.settings.caseSensitive ? "gu" : "giu";
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_/#-])#?${escapedTag}(?![\\p{L}\\p{N}_/-])`, flags);
        const walker = document.createTreeWalker(container, 4 /* SHOW_TEXT */);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || parent.closest("code, pre, script, style, mark.tra-highlight"))
                continue;
            if (pattern.test(node.nodeValue ?? "")) {
                pattern.lastIndex = 0;
                textNodes.push(node);
            }
            pattern.lastIndex = 0;
        }
        for (const textNode of textNodes) {
            const text = textNode.nodeValue ?? "";
            const fragment = document.createDocumentFragment();
            let cursor = 0;
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                if (match.index > cursor)
                    fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
                const mark = document.createElement("mark");
                mark.className = "tra-highlight";
                mark.textContent = match[0];
                fragment.appendChild(mark);
                cursor = match.index + match[0].length;
                if (match[0].length === 0)
                    pattern.lastIndex += 1;
            }
            if (cursor === 0)
                continue;
            if (cursor < text.length)
                fragment.appendChild(document.createTextNode(text.slice(cursor)));
            textNode.parentNode?.replaceChild(fragment, textNode);
        }
    }
    renderPendingChanges(root) {
        const changes = this.plugin.getPendingChanges();
        const section = root.createDiv({ cls: "tra-queue-card" });
        const header = section.createDiv({ cls: "tra-queue-header" });
        const titleGroup = header.createDiv({ cls: "tra-queue-title-group" });
        const icon = titleGroup.createDiv({ cls: "tra-queue-icon" });
        (0, obsidian_1.setIcon)(icon, "git-pull-request");
        const title = titleGroup.createDiv();
        title.createEl("h3", { text: "На изменение" });
        title.createEl("p", { text: "Проверьте список перед применением" });
        header.createSpan({ cls: "tra-queue-count", text: String(changes.length) });
        if (changes.length === 0) {
            const empty = section.createDiv({ cls: "tra-queue-empty" });
            empty.createEl("span", { text: "Очередь пока пуста" });
            empty.createEl("small", { text: "Выберите тег, чтобы переименовать его, удалить или снять маркировку #." });
            return;
        }
        const list = section.createDiv({ cls: "tra-queue-list" });
        for (const change of changes) {
            const row = list.createDiv({ cls: "tra-queue-row" });
            const mapping = row.createDiv({ cls: "tra-queue-mapping" });
            mapping.createDiv({ cls: "tra-queue-old", text: `#${change.oldTag}` });
            if (change.action === "delete" || change.newTag === null) {
                const deleteTarget = mapping.createDiv({ cls: "tra-queue-delete" });
                (0, obsidian_1.setIcon)(deleteTarget.createSpan(), "trash-2");
                deleteTarget.createSpan({ text: "Удалить тег" });
            }
            else if (change.action === "unmark") {
                const unmarkTarget = mapping.createDiv({ cls: "tra-queue-unmark" });
                (0, obsidian_1.setIcon)(unmarkTarget.createSpan(), "hash");
                unmarkTarget.createSpan({ text: "Убрать #" });
            }
            else {
                const arrow = mapping.createDiv({ cls: "tra-queue-arrow" });
                (0, obsidian_1.setIcon)(arrow.createSpan(), "arrow-right");
                mapping.createDiv({ cls: "tra-queue-new", text: `#${change.newTag}` });
            }
            const info = this.plugin.getTagInfo(change.oldTag);
            row.createDiv({ cls: "tra-queue-files", text: `${info?.files.length ?? 0} ${(0, utils_1.pluralRu)(info?.files.length ?? 0, "заметка", "заметки", "заметок")}` });
            const remove = row.createEl("button", { cls: "tra-remove-change", attr: { type: "button", title: "Убрать из очереди", "aria-label": `Убрать #${change.oldTag}` } });
            (0, obsidian_1.setIcon)(remove, "x");
            remove.addEventListener("click", () => this.plugin.removeChange(change.oldTag));
        }
        const totalFiles = this.plugin.affectedFiles(changes).length;
        const footer = section.createDiv({ cls: "tra-queue-footer" });
        footer.createSpan({ cls: "tra-queue-total", text: `${totalFiles} ${(0, utils_1.pluralRu)(totalFiles, "файл", "файла", "файлов")} затронуто` });
        const actions = section.createDiv({ cls: "tra-queue-actions" });
        const clear = actions.createEl("button", { cls: "tra-secondary-button", text: "Очистить" });
        clear.type = "button";
        clear.addEventListener("click", () => this.plugin.clearChanges());
        const apply = actions.createEl("button", { cls: "tra-primary-button tra-apply-button" });
        apply.type = "button";
        const applyIcon = apply.createSpan({ cls: "tra-button-icon" });
        (0, obsidian_1.setIcon)(applyIcon, "check-check");
        apply.createSpan({ text: "Применить" });
        apply.addEventListener("click", () => {
            const mergedTargets = this.plugin.existingMergeTargets(changes);
            new modals_1.ApplyConfirmModal(this.plugin.app, changes, totalFiles, mergedTargets, () => this.plugin.applyQueuedChanges()).open();
        });
    }
}


/* ===== main.js ===== */
class TagRefactorAuditorPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = { ...constants_1.DEFAULT_SETTINGS };
        this.tagIndex = new Map();
        this.pendingChanges = new Map();
        this.lastUndo = new Map();
        this.lastUndoLabel = "";
        this.isScanning = false;
        this.lastScanTime = 0;
        this.debounceTimer = null;
    }
    async onload() {
        await this.loadSettings();
        this.registerView(constants_1.VIEW_TYPE, (leaf) => new view_1.TagAuditorView(leaf, this));
        this.addRibbonIcon("tags", "Tag Refactor & Auditor", () => void this.activateView());
        this.addCommand({
            id: "open-tag-refactor-auditor",
            name: "Open Tag Refactor & Auditor",
            callback: () => void this.activateView(),
        });
        this.addCommand({
            id: "rescan-tags",
            name: "Rescan tags",
            callback: () => void this.scanTags(),
        });
        this.addCommand({
            id: "undo-last-refactor",
            name: "Undo last tag refactor",
            checkCallback: (checking) => {
                if (checking)
                    return this.lastUndo.size > 0;
                void this.undoLastBatch();
                return true;
            },
        });
        this.addSettingTab(new settings_1.TagAuditorSettingTab(this.app, this));
        this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("create", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("modify", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("delete", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("rename", () => this.scheduleScan()));
        this.app.workspace.onLayoutReady(() => void this.scanTags());
    }
    onunload() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        this.app.workspace.getLeavesOfType(constants_1.VIEW_TYPE).forEach((leaf) => leaf.detach());
    }
    async loadSettings() {
        const loaded = (await this.loadData());
        this.settings = {
            ...constants_1.DEFAULT_SETTINGS,
            ...(loaded ?? {}),
            previewChars: (0, utils_1.clampNumber)(loaded?.previewChars, 80, 1200, constants_1.DEFAULT_SETTINGS.previewChars),
            caseSensitive: Boolean(loaded?.caseSensitive ?? constants_1.DEFAULT_SETTINGS.caseSensitive),
            ignoredFolders: Array.isArray(loaded?.ignoredFolders)
                ? loaded.ignoredFolders.filter((path) => typeof path === "string")
                : [...constants_1.DEFAULT_SETTINGS.ignoredFolders],
            createdDateProperty: typeof loaded?.createdDateProperty === "string"
                ? loaded.createdDateProperty.trim()
                : constants_1.DEFAULT_SETTINGS.createdDateProperty,
            minTagMentions: (0, utils_1.clampNumber)(loaded?.minTagMentions, 0, 1000000, constants_1.DEFAULT_SETTINGS.minTagMentions),
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
        await this.scanTags();
    }
    async activateView() {
        const workspace = this.app.workspace;
        const leaves = workspace.getLeavesOfType(constants_1.VIEW_TYPE);
        const rootLeaves = new Set();
        workspace.iterateRootLeaves((rootLeaf) => rootLeaves.add(rootLeaf));

        // Reuse the view if it is already in the main workspace area. If an older
        // version left it in a sidebar, detach that instance and recreate it as a
        // normal center-area tab.
        let leaf = leaves.find((candidate) => rootLeaves.has(candidate));
        for (const existingLeaf of leaves) {
            if (existingLeaf !== leaf)
                existingLeaf.detach();
        }

        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({ type: constants_1.VIEW_TYPE, active: true });
        }
        await workspace.revealLeaf(leaf);
    }
    async scanTags() {
        if (this.isScanning)
            return;
        this.isScanning = true;
        try {
            this.tagIndex = (0, scanner_1.scanTagIndex)(this.app, this.settings);
            this.lastScanTime = Date.now();
        }
        finally {
            this.isScanning = false;
            this.refreshViews();
        }
    }
    scheduleScan() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            void this.scanTags();
        }, 300);
    }
    refreshViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(constants_1.VIEW_TYPE)) {
            if (leaf.view instanceof view_1.TagAuditorView)
                leaf.view.render();
        }
    }
    getTagInfo(tag) {
        return this.tagIndex.get((0, tag_utils_1.tagKey)(tag, this.settings.caseSensitive));
    }
    getPendingChanges() {
        return [...this.pendingChanges.values()];
    }
    affectedFiles(changes = this.getPendingChanges()) {
        return (0, scanner_1.filesAffectedByTags)(this.tagIndex, changes.map((change) => change.oldTag), this.settings.caseSensitive);
    }
    addOrUpdateChange(oldTagValue, newTagValue) {
        const oldTag = (0, tag_utils_1.normalizeTag)(oldTagValue);
        const newTag = (0, tag_utils_1.normalizeTag)((0, tag_utils_1.cleanTagInput)(newTagValue));
        if (!oldTag || !newTag) {
            new obsidian_1.Notice("Укажите старый и новый теги.");
            return false;
        }
        if (!(0, tag_utils_1.isValidTag)(newTag)) {
            new obsidian_1.Notice("Имя тега может содержать буквы, цифры, `_`, `-` и `/` для вложенности. Пробелы не поддерживаются.");
            return false;
        }
        const oldKey = (0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive);
        if (oldKey === (0, tag_utils_1.tagKey)(newTag, this.settings.caseSensitive)) {
            new obsidian_1.Notice("Старое и новое имена тегов совпадают.");
            return false;
        }
        if (!this.tagIndex.has(oldKey)) {
            new obsidian_1.Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        this.pendingChanges.set(oldKey, { oldTag: this.tagIndex.get(oldKey)?.tag ?? oldTag, newTag, action: "rename" });
        this.refreshViews();
        return true;
    }
    addDeleteTagChange(oldTagValue) {
        const oldTag = (0, tag_utils_1.normalizeTag)(oldTagValue);
        if (!oldTag) {
            new obsidian_1.Notice("Не удалось определить тег для удаления.");
            return false;
        }
        const oldKey = (0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new obsidian_1.Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: null, action: "delete" });
        new obsidian_1.Notice(`Удаление #${info.tag} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    addUnmarkTagChange(oldTagValue) {
        const oldTag = (0, tag_utils_1.normalizeTag)(oldTagValue);
        if (!oldTag) {
            new obsidian_1.Notice("Не удалось определить тег для снятия маркировки.");
            return false;
        }
        const oldKey = (0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new obsidian_1.Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: info.tag, action: "unmark" });
        new obsidian_1.Notice(`Снятие маркировки #${info.tag} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    removeChange(oldTag) {
        this.pendingChanges.delete((0, tag_utils_1.tagKey)(oldTag, this.settings.caseSensitive));
        this.refreshViews();
    }
    clearChanges() {
        this.pendingChanges.clear();
        this.refreshViews();
    }
    existingMergeTargets(changes = this.getPendingChanges()) {
        const targetKeys = new Set();
        const results = [];
        for (const change of changes) {
            if (change.action === "delete" || change.newTag === null)
                continue;
            const key = (0, tag_utils_1.tagKey)(change.newTag, this.settings.caseSensitive);
            if (key === (0, tag_utils_1.tagKey)(change.oldTag, this.settings.caseSensitive))
                continue;
            const existing = this.tagIndex.get(key);
            if (existing && !results.includes(change.newTag))
                results.push(change.newTag);
            if (targetKeys.has(key) && !results.includes(change.newTag))
                results.push(change.newTag);
            targetKeys.add(key);
        }
        return results;
    }
    async applyQueuedChanges() {
        const changes = this.getPendingChanges();
        const affected = this.affectedFiles(changes);
        const report = {
            requestedChanges: changes.length,
            updatedFiles: 0,
            unchangedFiles: 0,
            errors: [],
            mergedTargets: this.existingMergeTargets(changes),
        };
        const undoEntries = new Map();
        for (const file of affected) {
            let before = "";
            let after = "";
            try {
                await this.app.vault.process(file, (currentContent) => {
                    before = currentContent;
                    const result = (0, tag_utils_1.replaceTagsInMarkdown)(currentContent, changes, this.settings.caseSensitive);
                    after = result.text;
                    return result.text;
                });
                if (after !== before) {
                    report.updatedFiles += 1;
                    undoEntries.set(file.path, { before, after });
                }
                else {
                    report.unchangedFiles += 1;
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                report.errors.push(`${file.path}: ${message}`);
            }
        }
        if (undoEntries.size > 0) {
            this.lastUndo = undoEntries;
            this.lastUndoLabel = new Date().toLocaleString();
        }
        if (report.errors.length === 0)
            this.pendingChanges.clear();
        await this.scanTags();
        new modals_1.BatchReportModal(this.app, this, report).open();
        return report;
    }
    async undoLastBatch() {
        if (this.lastUndo.size === 0) {
            new obsidian_1.Notice("Нет операции, которую можно отменить.");
            return;
        }
        let restored = 0;
        let skipped = 0;
        const errors = [];
        for (const [path, entry] of this.lastUndo) {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (!(abstractFile instanceof obsidian_1.TFile)) {
                skipped += 1;
                continue;
            }
            let didRestore = false;
            try {
                await this.app.vault.process(abstractFile, (currentContent) => {
                    if (currentContent !== entry.after)
                        return currentContent;
                    didRestore = true;
                    return entry.before;
                });
                if (didRestore)
                    restored += 1;
                else
                    skipped += 1;
            }
            catch (error) {
                errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.lastUndo.clear();
        await this.scanTags();
        const summary = `Отменено: ${restored}. Пропущено (файл изменился после операции или удалён): ${skipped}. Ошибок: ${errors.length}.`;
        new obsidian_1.Notice(summary, 8000);
        new modals_1.BatchReportModal(this.app, this, {
            requestedChanges: 0,
            updatedFiles: restored,
            unchangedFiles: skipped,
            errors,
            mergedTargets: [],
        }, true).open();
    }
}


/* Local module namespaces reconstructed for the single-file plugin build. */
const constants_1 = { VIEW_TYPE, DEFAULT_SETTINGS };
const tag_utils_1 = { normalizeTag, tagKey, isValidTag, cleanTagInput, collectFrontmatterTags, replaceTagsInMarkdown, findInlineTagIndex };
const utils_1 = { appendExcerptWithHighlight, findTextIndex, pluralRu, relativeTime, clampNumber };
const scanner_1 = { isIgnoredPath, scanTagIndex, tagCountForFiles, filesAffectedByTags };
const modals_1 = { ApplyConfirmModal, BatchReportModal };
const settings_1 = { TagAuditorSettingTab };
const view_1 = { TagAuditorView };

module.exports = TagRefactorAuditorPlugin;
