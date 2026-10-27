"use strict";
/** Перенос тегов между текстом заметки и YAML-свойством tags. */
const { parseYaml } = require("obsidian");
const { addTagsToMarkdownDocument } = require("./add-tags.js");
const { extractNoteTags } = require("./extract.js");
const { collectFrontmatterTags, detectNewline, matchFrontmatter, rebuildFrontmatter } = require("./frontmatter.js");
const { containsActiveMarkdownTag, replaceBodyTags } = require("./markdown.js");
const { applyToPosts, listPosts } = require("./posts.js");
const { tagKey } = require("./tag-name.js");
const { replaceYamlTags } = require("./yaml.js");

function makeFilter(tags, caseSensitive) {
    if (!tags || tags.length === 0)
        return () => true;
    const keys = new Set(tags.map((tag) => tagKey(tag, caseSensitive)));
    return (tag) => keys.has(tagKey(tag, caseSensitive));
}

/** Delete tags from Markdown text and drop lines that held nothing but those tags. */
function removeInlineTags(text, tags, caseSensitive) {
    if (tags.length === 0)
        return text;
    const deletes = tags.map((oldTag) => ({ oldTag, newTag: null, action: "delete" }));
    const result = replaceBodyTags(text, deletes, caseSensitive);
    if (!result.changed)
        return text;
    // replaceBodyTags never adds or removes line breaks, so lines line up 1:1.
    const before = text.split(/(\r?\n)/);
    const after = result.text.split(/(\r?\n)/);
    if (before.length !== after.length)
        return result.text;
    const kept = [];
    for (let i = 0; i < after.length; i += 2) {
        const emptied = before[i].trim() !== "" && after[i].trim() === "";
        if (emptied)
            continue;
        kept.push(after[i]);
        if (i + 1 < after.length)
            kept.push(after[i + 1]);
    }
    let joined = kept.join("");
    // Keep the original trailing line break, if the removed line was the last one.
    if (/\r?\n$/.test(text) && !/\r?\n$/.test(joined) && joined.length > 0)
        joined += detectNewline(text);
    return joined;
}

/**
 * Move tags written in the text into the YAML `tags` property (created when
 * missing). `tags` limits the move to these names (empty = all inline tags),
 * `posts` limits it to chosen records. The note is left unchanged when its YAML
 * cannot be parsed, so no tag is ever lost.
 */
function moveTagsToYaml(content, options = {}) {
    const caseSensitive = Boolean(options.caseSensitive);
    const wanted = makeFilter(options.tags, caseSensitive);
    const match = matchFrontmatter(content);
    if (match && match.frontmatter.trim()) {
        try {
            const parsed = parseYaml(match.frontmatter);
            if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed)))
                return content;
        }
        catch {
            return content;
        }
    }
    const indices = options.posts ? new Set(options.posts) : new Set(listPosts(content).posts.map((post) => post.index));
    const moved = [];
    const seen = new Set();
    const stripped = applyToPosts(content, indices, (text) => {
        const found = extractNoteTags(text, caseSensitive).inline.filter(wanted);
        for (const tag of found) {
            const key = tagKey(tag, caseSensitive);
            if (!seen.has(key)) {
                seen.add(key);
                moved.push(tag);
            }
        }
        return removeInlineTags(text, found, caseSensitive);
    });
    if (moved.length === 0)
        return content;
    const result = addTagsToMarkdownDocument(stripped, moved, caseSensitive, [], true).text;
    // Safety net: every moved tag must now be in YAML, otherwise keep the original.
    const yamlKeys = new Set(extractNoteTags(result, caseSensitive).yaml.map((tag) => tagKey(tag, caseSensitive)));
    return moved.every((tag) => yamlKeys.has(tagKey(tag, caseSensitive))) ? result : content;
}

function appendTagLine(text, tags, newline) {
    const trailing = text.match(/(?:\r?\n)*$/)?.[0] ?? "";
    const core = text.slice(0, text.length - trailing.length);
    const line = tags.map((tag) => `#${tag}`).join(" ");
    if (core.trim() === "")
        return `${line}${trailing || newline}`;
    return `${core}${newline}${line}${trailing}`;
}

/**
 * Move tags from YAML `tag` / `tags` into the text as a `#tag` line. Without
 * `posts` the line goes to the end of the last non-empty record (before a
 * trailing `---`); with `posts` it is added to each chosen record.
 */
function moveTagsToText(content, options = {}) {
    const caseSensitive = Boolean(options.caseSensitive);
    const wanted = makeFilter(options.tags, caseSensitive);
    const match = matchFrontmatter(content);
    if (!match || !match.frontmatter.trim())
        return content;
    let parsed;
    try {
        parsed = parseYaml(match.frontmatter);
    }
    catch {
        return content;
    }
    const moved = collectFrontmatterTags(parsed).filter(wanted);
    if (moved.length === 0)
        return content;
    const yaml = replaceYamlTags(match.frontmatter, moved.map((oldTag) => ({ oldTag, newTag: null, action: "delete" })), caseSensitive);
    if (!yaml.changed)
        return content;
    const newline = detectNewline(content);
    const withoutYamlTags = `${rebuildFrontmatter(match, yaml.text, newline)}${content.slice(match.whole.length)}`;
    const { posts } = listPosts(withoutYamlTags);
    let targets;
    if (options.posts) {
        targets = new Set(options.posts);
    }
    else {
        const lastNonEmpty = [...posts].reverse().find((post) => !post.isEmpty);
        targets = new Set([(lastNonEmpty ?? posts[posts.length - 1])?.index ?? 0]);
    }
    const result = applyToPosts(withoutYamlTags, targets, (text) => {
        const missing = moved.filter((tag) => !containsActiveMarkdownTag(text, tag, caseSensitive));
        return missing.length > 0 ? appendTagLine(text, missing, newline) : text;
    });
    const inlineKeys = new Set(extractNoteTags(result, caseSensitive).inline.map((tag) => tagKey(tag, caseSensitive)));
    return moved.every((tag) => inlineKeys.has(tagKey(tag, caseSensitive))) ? result : content;
}

module.exports = { moveTagsToYaml, moveTagsToText };
