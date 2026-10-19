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
    const tagPattern = new RegExp(`(?<!\\\\)(?<![\\p{L}\\p{N}_/#-])#(?:${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_/-])`, flags);
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
                    return `\\#${rawOld}`;
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
    // unmark preserves the visible hash by escaping it with a Markdown backslash so Obsidian does not index it as a tag.
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
function yamlTagValues(value) {
    const values = Array.isArray(value) ? value : [value];
    return values.filter((item) => typeof item === "string").map((item) => normalizeTag(item)).filter(Boolean);
}
function findYamlFieldContainingTag(frontmatter, sourceTag, caseSensitive) {
    try {
        const parsed = (0, obsidian_1.parseYaml)(frontmatter);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return null;
        const sourceKey = tagKey(sourceTag, caseSensitive);
        for (const field of ["tags", "tag"]) {
            if (!Object.prototype.hasOwnProperty.call(parsed, field))
                continue;
            if (yamlTagValues(parsed[field]).some((value) => tagKey(value, caseSensitive) === sourceKey))
                return { field, parsed };
        }
    }
    catch {
        return null;
    }
    return null;
}
function splitYamlComment(raw) {
    let quote = null;
    let escaped = false;
    for (let i = 0; i < raw.length; i += 1) {
        const char = raw[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\" && quote === '"') {
            escaped = true;
            continue;
        }
        if (quote === "'") {
            if (char === "'" && raw[i + 1] === "'") {
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
        if (char === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
            return { value: raw.slice(0, i).trimEnd(), comment: raw.slice(i) };
        }
    }
    return { value: raw.trimEnd(), comment: "" };
}
function createPendingTagPlaceholder(content, targetTag, context, caseSensitive, replacements, placeholderCache, reservedTokens) {
    const cacheKey = `${context}:${tagKey(targetTag, caseSensitive)}`;
    const cached = placeholderCache.get(cacheKey);
    if (cached)
        return cached;
    let token = "";
    do {
        token = `tra_refactor_pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    } while (content.includes(token) || reservedTokens.has(token) || [...replacements.keys()].some((existing) => existing === token));
    placeholderCache.set(cacheKey, token);
    replacements.set(token, targetTag);
    reservedTokens.add(token);
    return token;
}
function addTagsToFrontmatter(frontmatter, field, newTags, caseSensitive, options) {
    if (!newTags.length)
        return { text: frontmatter, changed: false };
    let parsed;
    try {
        parsed = (0, obsidian_1.parseYaml)(frontmatter);
    }
    catch {
        return { text: frontmatter, changed: false };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return { text: frontmatter, changed: false };
    const existingAcrossFields = ["tags", "tag"].flatMap((key) => yamlTagValues(parsed[key]));
    const existingKeys = new Set(existingAcrossFields.map((value) => tagKey(value, caseSensitive)));
    for (const [placeholder, targetTag] of options.replacements) {
        if (frontmatter.includes(placeholder))
            existingKeys.add(tagKey(targetTag, caseSensitive));
    }
    const toAdd = [];
    for (const targetTag of newTags) {
        const key = tagKey(targetTag, caseSensitive);
        if (existingKeys.has(key) || toAdd.some((item) => tagKey(item, caseSensitive) === key))
            continue;
        toAdd.push(targetTag);
        existingKeys.add(key);
    }
    if (toAdd.length === 0)
        return { text: frontmatter, changed: false };

    const lines = frontmatter.split(/\r?\n/);
    const propertyIndex = lines.findIndex((line) => new RegExp(`^${field}\\s*:`).test(line));
    if (propertyIndex < 0)
        return { text: frontmatter, changed: false };
    const line = lines[propertyIndex];
    const colonIndex = line.indexOf(":");
    const prefix = line.slice(0, colonIndex + 1);
    const rawValue = line.slice(colonIndex + 1);
    const leading = rawValue.match(/^\s*/)?.[0] ?? "";
    const trimmedValue = rawValue.slice(leading.length);
    const placeholders = toAdd.map((targetTag) => createPendingTagPlaceholder(frontmatter, targetTag, "yaml", caseSensitive, options.replacements, options.placeholderCache, options.reservedTokens));

    if (trimmedValue.startsWith("[")) {
        const newline = frontmatter.includes("\r\n") ? "\r\n" : "\n";
        const remainder = lines.slice(propertyIndex).join(newline);
        const colon = remainder.indexOf(":");
        const openingBracket = remainder.indexOf("[", colon + 1);
        const relativeClosing = findFlowListClosing(remainder.slice(openingBracket));
        if (openingBracket < 0 || relativeClosing < 0)
            return { text: frontmatter, changed: false };
        const closingBracket = openingBracket + relativeClosing;
        const inner = remainder.slice(openingBracket + 1, closingBracket);
        const quotedPlaceholders = placeholders.map((placeholder) => JSON.stringify(placeholder));
        const trailingWhitespace = inner.match(/\s*$/)?.[0] ?? "";
        let core = inner.slice(0, inner.length - trailingWhitespace.length);
        if (core.trimEnd().endsWith(","))
            core = core.trimEnd().slice(0, -1).trimEnd();
        let nextInner;
        if (inner.includes("\n")) {
            const lastContentLine = core.split(/\r?\n/).reverse().find((candidate) => candidate.trim() !== "") ?? "";
            const indent = lastContentLine.match(/^\s*/)?.[0] ?? " ".repeat((line.match(/^\s*/)?.[0].length ?? 0) + 2);
            if (core.trim() === "")
                nextInner = `${newline}${indent}${quotedPlaceholders.join(`,${newline}${indent}`)}${trailingWhitespace}`;
            else
                nextInner = `${core},${newline}${indent}${quotedPlaceholders.join(`,${newline}${indent}`)}${trailingWhitespace}`;
        }
        else {
            nextInner = core.trim() === "" ? quotedPlaceholders.join(", ") : `${core}, ${quotedPlaceholders.join(", ")}`;
        }
        const updatedRemainder = `${remainder.slice(0, openingBracket + 1)}${nextInner}${remainder.slice(closingBracket)}`;
        lines.splice(propertyIndex, lines.length - propertyIndex, ...updatedRemainder.split(newline));
        return { text: lines.join(newline), changed: true };
    }

    if (Array.isArray(parsed[field])) {
        const propertyIndent = line.match(/^\s*/)?.[0].length ?? 0;
        let end = propertyIndex + 1;
        let listIndent = propertyIndent + 2;
        for (let i = propertyIndex + 1; i < lines.length; i += 1) {
            const candidate = lines[i];
            if (candidate.trim() === "") {
                end = i + 1;
                continue;
            }
            const indent = candidate.match(/^\s*/)?.[0].length ?? 0;
            if (indent <= propertyIndent)
                break;
            const listItem = candidate.match(/^(\s*)-\s+/);
            if (listItem)
                listIndent = listItem[1].length;
            end = i + 1;
        }
        // Append within this property's block, before the next top-level YAML key.
        const newLines = placeholders.map((placeholder) => `${" ".repeat(listIndent)}- ${JSON.stringify(placeholder)}`);
        lines.splice(end, 0, ...newLines);
        return { text: lines.join(frontmatter.includes("\r\n") ? "\r\n" : "\n"), changed: true };
    }

    // A scalar `tag: one` / `tags: one` becomes a flow list without losing the
    // original scalar quoting or an end-of-line YAML comment.
    const separated = splitYamlComment(trimmedValue);
    const decoded = decodeYamlScalar(separated.value.trim());
    const original = encodeYamlScalar(decoded.value, decoded.quote);
    lines[propertyIndex] = `${prefix}${leading}[${[original, ...placeholders.map((placeholder) => JSON.stringify(placeholder))].join(", ")}]${separated.comment ? ` ${separated.comment}` : ""}`;
    return { text: lines.join(frontmatter.includes("\r\n") ? "\r\n" : "\n"), changed: true };
}
function makeTagPattern(tag, caseSensitive) {
    const flags = caseSensitive ? "gu" : "giu";
    return new RegExp(`(?<!\\\\)(?<![\\p{L}\\p{N}_/#-])#${escapeRegExp(tag)}(?![\\p{L}\\p{N}_/-])`, flags);
}
function containsActiveMarkdownTag(markdown, tag, caseSensitive) {
    const pattern = makeTagPattern(tag, caseSensitive);
    const lines = markdown.split(/(\r?\n)/);
    let fenceChar = null;
    let fenceLength = 0;
    for (const line of lines) {
        if (line === "\n" || line === "\r\n")
            continue;
        const fence = line.match(/^\s*(`{3,}|~{3,})/);
        if (fence) {
            const marker = fence[1];
            if (fenceChar === null) {
                fenceChar = marker[0];
                fenceLength = marker.length;
            }
            else if (fenceChar === marker[0] && marker.length >= fenceLength) {
                fenceChar = null;
                fenceLength = 0;
            }
            continue;
        }
        if (fenceChar !== null)
            continue;
        const parts = line.split(/(`+[^`]*`+)/g);
        for (let i = 0; i < parts.length; i += 1) {
            if (i % 2 === 1 && /^`+/.test(parts[i]))
                continue;
            pattern.lastIndex = 0;
            if (pattern.test(parts[i]))
                return true;
        }
    }
    return false;
}
function splitMarkdownPostSegments(body) {
    const lineParts = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const result = [];
    let segment = "";
    let fenceChar = null;
    let fenceLength = 0;
    for (const line of lineParts) {
        const lineWithoutEnding = line.replace(/\r?\n$/, "");
        const fence = lineWithoutEnding.match(/^\s*(`{3,}|~{3,})/);
        let isInsideFence = fenceChar !== null;
        if (fence) {
            if (fenceChar === null) {
                fenceChar = fence[1][0];
                fenceLength = fence[1].length;
                isInsideFence = true;
            }
            else if (fenceChar === fence[1][0] && fence[1].length >= fenceLength) {
                isInsideFence = true;
                fenceChar = null;
                fenceLength = 0;
            }
        }
        const horizontalRule = !isInsideFence && /^\s{0,3}-{3,}[ \t]*$/.test(lineWithoutEnding);
        if (horizontalRule) {
            result.push({ type: "post", text: segment });
            result.push({ type: "separator", text: line });
            segment = "";
        }
        else {
            segment += line;
        }
    }
    result.push({ type: "post", text: segment });
    return result;
}
function appendTagLineToPost(post, tagPlaceholders, newline) {
    const trailingNewlines = post.match(/(?:\r?\n)*$/)?.[0] ?? "";
    const content = post.slice(0, post.length - trailingNewlines.length);
    if (content.length === 0)
        return post;
    return `${content}${newline}${tagPlaceholders.map((tag) => `#${tag}`).join(" ")}${trailingNewlines}`;
}
function addTagsToBodyPosts(body, sourceTag, newTags, caseSensitive, options) {
    const newline = body.includes("\r\n") ? "\r\n" : "\n";
    const segments = splitMarkdownPostSegments(body);
    let changed = false;
    let postIndex = -1;
    for (const part of segments) {
        if (part.type !== "post")
            continue;
        postIndex += 1;
        if (!containsActiveMarkdownTag(part.text, sourceTag, caseSensitive))
            continue;
        const existingTags = new Set();
        for (const targetTag of newTags) {
            if (containsActiveMarkdownTag(part.text, targetTag, caseSensitive))
                existingTags.add(tagKey(targetTag, caseSensitive));
        }
        const placeholders = [];
        for (const targetTag of newTags) {
            const key = tagKey(targetTag, caseSensitive);
            if (existingTags.has(key))
                continue;
            const alreadyQueued = options.bodyAddedByPost.get(postIndex);
            if (alreadyQueued?.has(key))
                continue;
            const placeholder = createPendingTagPlaceholder(body, targetTag, "body", caseSensitive, options.replacements, options.placeholderCache, options.reservedTokens);
            placeholders.push(placeholder);
            if (!options.bodyAddedByPost.has(postIndex))
                options.bodyAddedByPost.set(postIndex, new Set());
            options.bodyAddedByPost.get(postIndex).add(key);
        }
        if (placeholders.length > 0) {
            part.text = appendTagLineToPost(part.text, placeholders, newline);
            changed = true;
        }
    }
    return { text: segments.map((part) => part.text).join(""), changed };
}
/**
 * Add tags in the same place as the source tag: YAML tag metadata if the source
 * exists there, otherwise in each Markdown post containing its inline mention.
 * Placeholders shield the newly-added tags from other operations in the same batch.
 */
function addTagsToMarkdown(content, additionChanges, caseSensitive) {
    let text = content;
    let changed = false;
    const replacements = new Map();
    const placeholderCache = new Map();
    const reservedTokens = new Set();
    const bodyAddedByPost = new Map();
    for (const change of additionChanges) {
        const sourceTag = normalizeTag(change.oldTag);
        const newTags = Array.isArray(change.addTags) ? change.addTags.map((value) => normalizeTag(value)).filter(Boolean) : [];
        if (!sourceTag || newTags.length === 0)
            continue;
        for (const item of additionChanges) {
            const oldTag = normalizeTag(item.oldTag);
            const newTag = normalizeTag(item.newTag);
            if (oldTag)
                reservedTokens.add(oldTag);
            if (newTag)
                reservedTokens.add(newTag);
            for (const addedTag of item.addTags ?? []) {
                const normalized = normalizeTag(addedTag);
                if (normalized)
                    reservedTokens.add(normalized);
            }
        }
        const frontmatterMatch = text.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---\s*(?:\r?\n|$))/);
        if (frontmatterMatch) {
            const [whole, opening, frontmatter, closing] = frontmatterMatch;
            const field = findYamlFieldContainingTag(frontmatter, sourceTag, caseSensitive);
            if (field) {
                const yaml = addTagsToFrontmatter(frontmatter, field.field, newTags, caseSensitive, {
                    replacements,
                    placeholderCache,
                    reservedTokens,
                });
                if (yaml.changed) {
                    text = `${opening}${yaml.text}${closing}${text.slice(whole.length)}`;
                    changed = true;
                }
                // If the source tag is a YAML tag, never duplicate the addition in the body.
                continue;
            }
        }
        const currentFrontmatter = text.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---\s*(?:\r?\n|$))/);
        const body = currentFrontmatter ? text.slice(currentFrontmatter[0].length) : text;
        const bodyResult = addTagsToBodyPosts(body, sourceTag, newTags, caseSensitive, {
            replacements,
            placeholderCache,
            reservedTokens,
            bodyAddedByPost,
        });
        if (bodyResult.changed) {
            text = currentFrontmatter ? `${currentFrontmatter[0]}${bodyResult.text}` : bodyResult.text;
            changed = true;
        }
    }
    return { text, changed, replacements };
}
/** Apply queued tag operations to one file without writing it. */
function replaceTagsInMarkdown(content, changes, caseSensitive) {
    const additions = changes.filter((change) => change.action === "add");
    const mutations = changes.filter((change) => change.action !== "add");
    const added = addTagsToMarkdown(content, additions, caseSensitive);
    const frontmatterMatch = added.text.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---\s*(?:\r?\n|$))/);
    let replaced;
    if (!frontmatterMatch) {
        replaced = replaceBodyTags(added.text, mutations, caseSensitive);
    }
    else {
        const [whole, opening, frontmatter, closing] = frontmatterMatch;
        const afterFrontmatter = added.text.slice(whole.length);
        const yaml = replaceYamlTags(frontmatter, mutations, caseSensitive);
        const body = replaceBodyTags(afterFrontmatter, mutations, caseSensitive);
        replaced = { text: `${opening}${yaml.text}${closing}${body.text}`, changed: yaml.changed || body.changed };
    }
    let resolvedText = replaced.text;
    for (const [placeholder, targetTag] of added.replacements)
        resolvedText = resolvedText.split(placeholder).join(targetTag);
    return { text: resolvedText, changed: added.changed || replaced.changed };
}
function findInlineTagIndex(content, tag, caseSensitive) {
    const escaped = escapeRegExp(normalizeTag(tag) ?? tag);
    const flags = caseSensitive ? "u" : "iu";
    const regex = new RegExp(`(?<![\\p{L}\\p{N}_/#-])#${escaped}(?![\\p{L}\\p{N}_/-])`, flags);
    const match = regex.exec(content);
    return match?.index ?? -1;
}

export { normalizeTag, tagKey, isValidTag, cleanTagInput, collectFrontmatterTags, replaceTagsInMarkdown, findInlineTagIndex, addTagsToMarkdown };
