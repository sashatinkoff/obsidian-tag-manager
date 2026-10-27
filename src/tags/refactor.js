"use strict";
/** Применение всей очереди операций к одному файлу. */
const { addTagsToMarkdown } = require("./add-tags.js");
const { detectNewline, rebuildFrontmatter, matchFrontmatter } = require("./frontmatter.js");
const { replaceBodyTags } = require("./markdown.js");
const { replaceYamlTags } = require("./yaml.js");

/** Apply queued tag operations to one file without writing it. */
function replaceTagsInMarkdown(content, changes, caseSensitive) {
    const additions = changes.filter((change) => change.action === "add");
    const mutations = changes.filter((change) => change.action !== "add");
    const added = addTagsToMarkdown(content, additions, caseSensitive);
    const frontmatterMatch = matchFrontmatter(added.text);
    let replaced;
    if (!frontmatterMatch) {
        replaced = replaceBodyTags(added.text, mutations, caseSensitive);
    }
    else {
        const afterFrontmatter = added.text.slice(frontmatterMatch.whole.length);
        const yaml = replaceYamlTags(frontmatterMatch.frontmatter, mutations, caseSensitive);
        const body = replaceBodyTags(afterFrontmatter, mutations, caseSensitive);
        replaced = {
            text: `${rebuildFrontmatter(frontmatterMatch, yaml.text, detectNewline(added.text))}${body.text}`,
            changed: yaml.changed || body.changed,
        };
    }
    let resolvedText = replaced.text;
    for (const [placeholder, targetTag] of added.replacements)
        resolvedText = resolvedText.split(placeholder).join(targetTag);
    return { text: resolvedText, changed: resolvedText !== content };
}

module.exports = { replaceTagsInMarkdown };
