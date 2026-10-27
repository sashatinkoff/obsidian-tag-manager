"use strict";
/** Поиск и сборка YAML-фронтматтера, чтение значений tag/tags. */
const { normalizeTag } = require("./tag-name.js");

const FRONTMATTER_PATTERN = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;
const EMPTY_FRONTMATTER_PATTERN = /^(\uFEFF?---[ \t]*\r?\n)(---[ \t]*(?:\r?\n|$))/;
/**
 * Locate YAML frontmatter. An empty block (`---` immediately followed by `---`)
 * is checked first: the general pattern would otherwise run past it and treat
 * the following Markdown as YAML.
 */
function matchFrontmatter(text) {
    const empty = text.match(EMPTY_FRONTMATTER_PATTERN);
    if (empty)
        return { whole: empty[0], opening: empty[1], frontmatter: "", closing: empty[2], empty: true };
    const match = text.match(FRONTMATTER_PATTERN);
    if (match)
        return { whole: match[0], opening: match[1], frontmatter: match[2], closing: match[3], empty: false };
    return null;
}
/** Rebuild a frontmatter block, adding the separator line an empty block lacks. */
function joinFrontmatter(match, frontmatter, newline) {
    if (match.empty && frontmatter.length > 0)
        return `${match.opening}${frontmatter}${newline}${match.closing}`;
    return `${match.opening}${frontmatter}${match.closing}`;
}
/**
 * Like joinFrontmatter, but drops the whole block when an edit left it empty
 * (e.g. the last tag was removed from a frontmatter that only held `tags`).
 */
function rebuildFrontmatter(match, frontmatter, newline) {
    if (frontmatter.trim() === "" && match.frontmatter.trim() !== "")
        return match.opening.startsWith("\uFEFF") ? "\uFEFF" : "";
    return joinFrontmatter(match, frontmatter, newline);
}
function stripFrontmatter(text) {
    const match = matchFrontmatter(text);
    return match ? text.slice(match.whole.length) : text;
}
function detectNewline(text) {
    return text.includes("\r\n") ? "\r\n" : "\n";
}
/**
 * Values of YAML `tags` / `tag`. Besides lists, Obsidian accepts a plain string
 * with several tags separated by commas or spaces (`tags: one, two`).
 */
function yamlTagValues(value) {
    const values = Array.isArray(value) ? value : [value];
    const result = [];
    for (const item of values) {
        if (typeof item !== "string")
            continue;
        for (const part of item.split(/[\s,]+/)) {
            const tag = normalizeTag(part);
            if (tag)
                result.push(tag);
        }
    }
    return result;
}
function collectFrontmatterTags(frontmatter) {
    if (!frontmatter || typeof frontmatter !== "object")
        return [];
    const record = frontmatter;
    return [...yamlTagValues(record.tags), ...yamlTagValues(record.tag)];
}

module.exports = { matchFrontmatter, joinFrontmatter, rebuildFrontmatter, stripFrontmatter, detectNewline, yamlTagValues, collectFrontmatterTags };
