"use strict";
/** Все теги заметки прямо из её текста: YAML tag/tags и теги в Markdown (вне кода и ссылок). */
const { parseYaml } = require("obsidian");
const { collectFrontmatterTags, matchFrontmatter } = require("./frontmatter.js");
const { mapMarkdownText } = require("./markdown.js");
const { normalizeTag, tagKey } = require("./tag-name.js");

// Same boundaries as tag replacement: not after a letter/digit/#/backslash, so
// `a#b`, `\#escaped` and `##` are not tags.
const INLINE_TAG_PATTERN = /(?<!\\)(?<![\p{L}\p{N}_/#-])#([\p{L}\p{N}_/-]+)/gu;

/**
 * @returns {{ yaml: string[], inline: string[], all: string[] }} tags without "#",
 *          de-duplicated by key; `all` lists YAML tags first, then inline ones.
 */
function extractNoteTags(content, caseSensitive) {
    const yaml = [];
    const inline = [];
    const seenYaml = new Set();
    const seenInline = new Set();
    const match = matchFrontmatter(content);
    if (match && match.frontmatter.trim()) {
        try {
            for (const tag of collectFrontmatterTags(parseYaml(match.frontmatter))) {
                const key = tagKey(tag, caseSensitive);
                if (!seenYaml.has(key)) {
                    seenYaml.add(key);
                    yaml.push(tag);
                }
            }
        }
        catch {
            // Invalid YAML: Obsidian does not read tags from it either.
        }
    }
    const body = match ? content.slice(match.whole.length) : content;
    mapMarkdownText(body, (part) => {
        for (const found of part.matchAll(INLINE_TAG_PATTERN)) {
            const tag = normalizeTag(found[1].replace(/\/+$/, ""));
            // Obsidian requires at least one non-digit character in a tag.
            if (!tag || /^[\d/]+$/.test(tag))
                continue;
            const key = tagKey(tag, caseSensitive);
            if (!seenInline.has(key)) {
                seenInline.add(key);
                inline.push(tag);
            }
        }
        return part;
    });
    const all = [...yaml];
    for (const tag of inline) {
        if (!seenYaml.has(tagKey(tag, caseSensitive)))
            all.push(tag);
    }
    return { yaml, inline, all };
}

module.exports = { extractNoteTags };
