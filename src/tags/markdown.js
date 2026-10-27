"use strict";
/** Работа с тегами в тексте Markdown: обход вне кода и ссылок, замена, поиск, деление на записи. */
const { makeChangeMap } = require("./changes.js");
const { escapeRegExp, normalizeTag, tagKey } = require("./tag-name.js");

const TAG_BOUNDARY_BEFORE = "(?<!\\\\)(?<![\\p{L}\\p{N}_/#-])";
const TAG_BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_/-])";
// Spans where `#word` is not a tag: inline code, wikilinks (`[[#Heading]]`,
// `[[note#Heading|alias]]`) and Markdown link destinations (`](url#anchor)`).
const PROTECTED_INLINE_PATTERN = /(`+[^`]*`+|\[\[[^\]\n]*\]\]|\]\([^)\n]*\))/g;
/**
 * Call `mapper` for every piece of ordinary Markdown text, skipping fenced code
 * blocks and protected inline spans. Returns the reassembled text.
 */
function mapMarkdownText(body, mapper) {
    const lines = body.split(/(\r?\n)/);
    let fenceChar = null;
    let fenceLength = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (line === "\n" || line === "\r\n" || line === "")
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
        const parts = line.split(PROTECTED_INLINE_PATTERN);
        let lineChanged = false;
        for (let i = 0; i < parts.length; i += 2) {
            if (!parts[i])
                continue;
            const next = mapper(parts[i]);
            if (next !== parts[i]) {
                parts[i] = next;
                lineChanged = true;
            }
        }
        if (lineChanged)
            lines[lineIndex] = parts.join("");
    }
    return lines.join("");
}
/**
 * Replace tags in Markdown body text, while leaving code, wikilinks and link
 * destinations alone. A single alternation performs all replacements against the
 * original text, so chained mappings do not cascade (A -> B and B -> C leaves
 * original A as B). Deleting a tag also removes the whitespace it leaves behind.
 */
function replaceBodyTags(body, changes, caseSensitive) {
    const changeMap = makeChangeMap(changes, caseSensitive);
    if (changeMap.size === 0)
        return { text: body, changed: false };
    const names = changes
        .map((change) => normalizeTag(change.oldTag))
        .filter((tag) => Boolean(tag))
        .sort((a, b) => b.length - a.length);
    const flags = caseSensitive ? "gu" : "giu";
    // The lookbehind prevents matches embedded in another tag/word; the trailing
    // boundary avoids changing #tag inside #tagging or a nested #tag/child.
    const tagPattern = new RegExp(`([ \\t]*)${TAG_BOUNDARY_BEFORE}#(${names.map(escapeRegExp).join("|")})${TAG_BOUNDARY_AFTER}([ \\t]*)`, flags);
    let changed = false;
    const text = mapMarkdownText(body, (part) => {
        let deleted = false;
        const replaced = part.replace(tagPattern, (matched, before, rawOld, after) => {
            const operation = changeMap.get(tagKey(rawOld, caseSensitive));
            if (!operation)
                return matched;
            changed = true;
            if (operation.action === "unmark")
                return `${before}\\#${rawOld}${after}`;
            if (operation.action === "rename")
                return `${before}#${operation.newTag}${after}`;
            deleted = true;
            // "a #tag b" -> "a b", "#tag b" -> "b", "a #tag" -> "a".
            return before && after ? before : "";
        });
        // Several deleted tags at the end of a line ("text #a #b") must not leave a trailing space.
        if (deleted && !/[ \t]$/.test(part))
            return replaced.replace(/[ \t]+$/, "");
        return replaced;
    });
    return { text, changed };
}
function makeTagPattern(tag, caseSensitive) {
    const flags = caseSensitive ? "u" : "iu";
    return new RegExp(`${TAG_BOUNDARY_BEFORE}#${escapeRegExp(tag)}${TAG_BOUNDARY_AFTER}`, flags);
}
function containsActiveMarkdownTag(markdown, tag, caseSensitive) {
    const pattern = makeTagPattern(tag, caseSensitive);
    let found = false;
    mapMarkdownText(markdown, (part) => {
        if (!found && pattern.test(part))
            found = true;
        return part;
    });
    return found;
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
function findInlineTagIndex(content, tag, caseSensitive) {
    const match = makeTagPattern(normalizeTag(tag) ?? tag, caseSensitive).exec(content);
    return match?.index ?? -1;
}

module.exports = { mapMarkdownText, replaceBodyTags, containsActiveMarkdownTag, splitMarkdownPostSegments, findInlineTagIndex };
