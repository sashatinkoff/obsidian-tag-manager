import * as obsidian_1 from "obsidian";
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

export { normalizeTag, tagKey, isValidTag, cleanTagInput, collectFrontmatterTags, replaceTagsInMarkdown, findInlineTagIndex };
