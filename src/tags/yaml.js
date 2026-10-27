"use strict";
/** Построчное изменение YAML tag/tags без потери форматирования. */
const { parseYaml } = require("obsidian");
const { makeChangeMap } = require("./changes.js");
const { detectNewline, yamlTagValues } = require("./frontmatter.js");
const { normalizeTag, tagKey } = require("./tag-name.js");

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
function yamlItemKey(raw, caseSensitive) {
    if (raw === null)
        return null;
    const { value } = splitYamlComment(raw.trim());
    const tag = normalizeTag(decodeYamlScalar(value).value);
    return tag ? tagKey(tag, caseSensitive) : null;
}
/**
 * Apply changes to a sequence of YAML scalars. Returns one entry per input:
 * the rewritten scalar or null when it must be removed. A renamed entry whose
 * target already exists in the same list is removed as well, so `[a, b]` with
 * a -> b becomes `[b]` instead of `[b, b]`.
 */
function rewriteYamlItems(items, changes, caseSensitive) {
    const next = items.map((raw) => replaceYamlScalar(raw, changes, caseSensitive));
    const seen = new Set();
    items.forEach((raw, index) => {
        if (next[index] === raw) {
            const key = yamlItemKey(raw, caseSensitive);
            if (key)
                seen.add(key);
        }
    });
    let changed = false;
    const results = next.map((value, index) => {
        if (value === items[index])
            return value;
        changed = true;
        if (value === null)
            return null;
        const key = yamlItemKey(value, caseSensitive);
        if (key && seen.has(key))
            return null;
        if (key)
            seen.add(key);
        return value;
    });
    return { results, changed };
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
        const items = splitFlowList(remaining.slice(0, closingIndex + 1));
        if (!items)
            return { line, changed: false };
        const rewritten = rewriteYamlItems(items, changes, caseSensitive);
        if (!rewritten.changed)
            return { line, changed: false };
        const kept = rewritten.results.filter((item) => item !== null);
        if (kept.length === 0)
            return { line: null, changed: true };
        // Keep the original spacing right after `[` even if the first item was removed.
        const firstLeading = items[0].match(/^\s*/)?.[0] ?? "";
        kept[0] = `${firstLeading}${kept[0].trimStart()}`;
        return {
            line: `${prefix}${leading}[${kept.join(",")}]${remaining.slice(closingIndex + 1)}`,
            changed: true,
        };
    }
    // A plain scalar holding several tags: `tags: one, two` or `tags: one two`.
    const separated = splitYamlComment(remaining);
    const plain = separated.value.trim();
    if (plain && !/^['"|>&*!{]/.test(plain) && /[\s,]/.test(plain)) {
        const tokens = plain.split(/\s*,\s*|\s+/).filter(Boolean);
        const rewritten = rewriteYamlItems(tokens, changes, caseSensitive);
        if (!rewritten.changed)
            return { line, changed: false };
        const kept = rewritten.results.filter((item) => item !== null);
        if (kept.length === 0)
            return { line: null, changed: true };
        const separator = plain.includes(",") ? ", " : " ";
        return {
            line: `${prefix}${leading || " "}${kept.join(separator)}${separated.comment ? ` ${separated.comment}` : ""}`,
            changed: true,
        };
    }
    const rewritten = replaceYamlScalar(value, changes, caseSensitive);
    if (rewritten === null)
        return { line: null, changed: true };
    return { line: `${prefix}${rewritten}`, changed: rewritten !== value };
}
function yamlIndent(line) {
    return line.match(/^[ \t]*/)?.[0].length ?? 0;
}
/**
 * Lines that belong to the block value of the property on `index`: deeper
 * indented lines plus compact sequences (`tags:\n- one`) at the same indent.
 * `end` is exclusive and points after the last non-blank member line.
 */
function yamlBlockRange(lines, index) {
    const propertyIndent = yamlIndent(lines[index]);
    let end = index + 1;
    for (let j = index + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (candidate.trim() === "")
            continue;
        const indent = yamlIndent(candidate);
        if (indent > propertyIndent || (indent === propertyIndent && /^[ \t]*-(?:\s|$)/.test(candidate))) {
            end = j + 1;
            continue;
        }
        break;
    }
    return { start: index + 1, end };
}
const YAML_LIST_ITEM_PATTERN = /^([ \t]*-[ \t]+)(.*)$/;
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
        parseYaml(frontmatter);
    }
    catch {
        return { text: frontmatter, changed: false };
    }
    const newline = detectNewline(frontmatter);
    const lines = frontmatter.split(/\r?\n/);
    let changed = false;
    for (let i = 0; i < lines.length; i += 1) {
        if (!/^tags?\s*:/.test(lines[i]))
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
        if (splitYamlComment(lines[i].slice(colonIndex + 1)).value.trim() !== "")
            continue;

        // Block arrays such as `tags:\n  - one` or `tags:\n- one`. Removing a
        // scalar removes that list item; if all items were removed, the
        // now-empty property is removed as well.
        const range = yamlBlockRange(lines, i);
        const itemIndices = [];
        for (let j = range.start; j < range.end; j += 1) {
            if (YAML_LIST_ITEM_PATTERN.test(lines[j]))
                itemIndices.push(j);
        }
        if (itemIndices.length === 0)
            continue;
        const matches = itemIndices.map((j) => lines[j].match(YAML_LIST_ITEM_PATTERN));
        const result = rewriteYamlItems(matches.map((match) => match[2]), changeMap, caseSensitive);
        if (!result.changed)
            continue;
        changed = true;
        const remove = new Set();
        itemIndices.forEach((j, index) => {
            const value = result.results[index];
            if (value === null)
                remove.add(j);
            else
                lines[j] = `${matches[index][1]}${value}`;
        });
        const removeProperty = remove.size === itemIndices.length;
        if (removeProperty)
            remove.add(i);
        for (const j of [...remove].sort((x, y) => y - x))
            lines.splice(j, 1);
        if (removeProperty)
            i -= 1;
    }
    if (!changed)
        return { text: frontmatter, changed: false };
    const result = lines.join(newline);
    try {
        parseYaml(result);
        return { text: result, changed };
    }
    catch {
        return { text: frontmatter, changed: false };
    }
}
function findYamlFieldContainingTag(frontmatter, sourceTag, caseSensitive) {
    try {
        const parsed = parseYaml(frontmatter);
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

module.exports = { decodeYamlScalar, encodeYamlScalar, yamlIndent, yamlBlockRange, findFlowListClosing, replaceYamlTags, findYamlFieldContainingTag, splitYamlComment };
