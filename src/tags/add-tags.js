"use strict";
/** Добавление тегов в YAML или в текст записей. */
const { parseYaml } = require("obsidian");
const { detectNewline, joinFrontmatter, matchFrontmatter, yamlTagValues } = require("./frontmatter.js");
const { containsActiveMarkdownTag, splitMarkdownPostSegments } = require("./markdown.js");
const { isValidTag, normalizeTag, tagKey } = require("./tag-name.js");
const { decodeYamlScalar, encodeYamlScalar, findFlowListClosing, findYamlFieldContainingTag, splitYamlComment, yamlBlockRange, yamlIndent } = require("./yaml.js");

function createPendingTagPlaceholder(content, targetTag, context, caseSensitive, replacements, placeholderCache, reservedTokens) {
    const cacheKey = `${context}:${tagKey(targetTag, caseSensitive)}`;
    const cached = placeholderCache.get(cacheKey);
    if (cached)
        return cached;
    let token = "";
    do {
        token = `tra_refactor_pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    } while (content.includes(token) || reservedTokens.has(token) || replacements.has(token));
    placeholderCache.set(cacheKey, token);
    replacements.set(token, targetTag);
    reservedTokens.add(token);
    return token;
}
function addTagsToFrontmatter(frontmatter, field, newTags, caseSensitive, options) {
    const unchanged = { text: frontmatter, changed: false };
    if (!newTags.length)
        return unchanged;
    let parsed;
    try {
        parsed = parseYaml(frontmatter);
    }
    catch {
        return unchanged;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return unchanged;
    const existingAcrossFields = ["tags", "tag"].flatMap((key) => yamlTagValues(parsed[key]));
    const existingKeys = new Set(existingAcrossFields.map((value) => tagKey(value, caseSensitive)));
    for (const [placeholder, targetTag] of options.replacements) {
        if (frontmatter.includes(placeholder))
            existingKeys.add(tagKey(targetTag, caseSensitive));
    }
    const toAdd = [];
    for (const targetTag of newTags) {
        const key = tagKey(targetTag, caseSensitive);
        if (existingKeys.has(key))
            continue;
        toAdd.push(targetTag);
        existingKeys.add(key);
    }
    if (toAdd.length === 0)
        return unchanged;

    const newline = detectNewline(frontmatter);
    const lines = frontmatter.split(/\r?\n/);
    const propertyIndex = lines.findIndex((line) => new RegExp(`^${field}\\s*:`).test(line));
    if (propertyIndex < 0)
        return unchanged;
    const line = lines[propertyIndex];
    const colonIndex = line.indexOf(":");
    const prefix = line.slice(0, colonIndex + 1);
    const rawValue = line.slice(colonIndex + 1);
    const leading = rawValue.match(/^\s*/)?.[0] ?? "";
    const trimmedValue = rawValue.slice(leading.length);
    const placeholders = toAdd.map((targetTag) => createPendingTagPlaceholder(frontmatter, targetTag, "yaml", caseSensitive, options.replacements, options.placeholderCache, options.reservedTokens));
    const quotedPlaceholders = placeholders.map((placeholder) => JSON.stringify(placeholder));
    let updated;

    if (trimmedValue.startsWith("[")) {
        const remainder = lines.slice(propertyIndex).join(newline);
        const colon = remainder.indexOf(":");
        const openingBracket = remainder.indexOf("[", colon + 1);
        const relativeClosing = openingBracket < 0 ? -1 : findFlowListClosing(remainder.slice(openingBracket));
        if (openingBracket < 0 || relativeClosing < 0)
            return unchanged;
        const closingBracket = openingBracket + relativeClosing;
        const inner = remainder.slice(openingBracket + 1, closingBracket);
        const trailingWhitespace = inner.match(/\s*$/)?.[0] ?? "";
        let core = inner.slice(0, inner.length - trailingWhitespace.length);
        if (core.trimEnd().endsWith(","))
            core = core.trimEnd().slice(0, -1).trimEnd();
        let nextInner;
        if (inner.includes("\n")) {
            const lastContentLine = core.split(/\r?\n/).reverse().find((candidate) => candidate.trim() !== "") ?? "";
            const indent = lastContentLine.match(/^\s*/)?.[0] || " ".repeat(yamlIndent(line) + 2);
            const joined = quotedPlaceholders.join(`,${newline}${indent}`);
            nextInner = core.trim() === ""
                ? `${newline}${indent}${joined}${trailingWhitespace}`
                : `${core},${newline}${indent}${joined}${trailingWhitespace}`;
        }
        else {
            nextInner = core.trim() === "" ? quotedPlaceholders.join(", ") : `${core}, ${quotedPlaceholders.join(", ")}`;
        }
        const updatedRemainder = `${remainder.slice(0, openingBracket + 1)}${nextInner}${remainder.slice(closingBracket)}`;
        lines.splice(propertyIndex, lines.length - propertyIndex, ...updatedRemainder.split(newline));
        updated = lines.join(newline);
    }
    else {
        const separated = splitYamlComment(trimmedValue);
        const plain = separated.value.trim();
        if (plain === "") {
            // `tags:` with a block list below it, or an empty property.
            const value = parsed[field];
            let itemIndent = " ".repeat(yamlIndent(line) + 2);
            let insertAt = propertyIndex + 1;
            if (Array.isArray(value)) {
                const range = yamlBlockRange(lines, propertyIndex);
                let foundItem = false;
                for (let j = range.start; j < range.end; j += 1) {
                    const item = lines[j].match(/^([ \t]*)-(?:\s|$)/);
                    if (item) {
                        itemIndent = item[1];
                        foundItem = true;
                    }
                }
                if (!foundItem)
                    return unchanged;
                insertAt = range.end;
            }
            else if (value !== null && value !== undefined && value !== "") {
                return unchanged;
            }
            lines.splice(insertAt, 0, ...quotedPlaceholders.map((placeholder) => `${itemIndent}- ${placeholder}`));
        }
        else if (/^[|>&*!{]/.test(plain)) {
            // Block scalars, anchors and mappings are left for the user to edit.
            return unchanged;
        }
        else {
            // A scalar `tags: one` / `tags: one, two` becomes a flow list without
            // losing the original quoting or an end-of-line YAML comment.
            const decoded = decodeYamlScalar(plain);
            const originals = decoded.quote
                ? [encodeYamlScalar(decoded.value, decoded.quote)]
                : plain.split(/\s*,\s*|\s+/).filter(Boolean);
            lines[propertyIndex] = `${prefix}${leading || " "}[${[...originals, ...quotedPlaceholders].join(", ")}]${separated.comment ? ` ${separated.comment}` : ""}`;
        }
        updated = lines.join(newline);
    }
    // Never write frontmatter that no longer parses.
    try {
        parseYaml(updated);
    }
    catch {
        return unchanged;
    }
    return { text: updated, changed: true };
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
    if (additionChanges.length === 0)
        return { text, changed, replacements };
    for (const item of additionChanges) {
        for (const value of [item.oldTag, item.newTag, ...(item.addTags ?? [])]) {
            const normalized = normalizeTag(value);
            if (normalized)
                reservedTokens.add(normalized);
        }
    }
    for (const change of additionChanges) {
        const sourceTag = normalizeTag(change.oldTag);
        const newTags = Array.isArray(change.addTags) ? change.addTags.map((value) => normalizeTag(value)).filter(Boolean) : [];
        if (!sourceTag || newTags.length === 0)
            continue;
        const frontmatterMatch = matchFrontmatter(text);
        if (frontmatterMatch) {
            const field = findYamlFieldContainingTag(frontmatterMatch.frontmatter, sourceTag, caseSensitive);
            if (field) {
                const yaml = addTagsToFrontmatter(frontmatterMatch.frontmatter, field.field, newTags, caseSensitive, {
                    replacements,
                    placeholderCache,
                    reservedTokens,
                });
                if (yaml.changed) {
                    text = `${joinFrontmatter(frontmatterMatch, yaml.text, detectNewline(text))}${text.slice(frontmatterMatch.whole.length)}`;
                    changed = true;
                }
                // If the source tag is a YAML tag, never duplicate the addition in the body.
                continue;
            }
        }
        const currentFrontmatter = frontmatterMatch;
        const body = currentFrontmatter ? text.slice(currentFrontmatter.whole.length) : text;
        const bodyResult = addTagsToBodyPosts(body, sourceTag, newTags, caseSensitive, {
            replacements,
            placeholderCache,
            reservedTokens,
            bodyAddedByPost,
        });
        if (bodyResult.changed) {
            text = currentFrontmatter ? `${currentFrontmatter.whole}${bodyResult.text}` : bodyResult.text;
            changed = true;
        }
    }
    return { text, changed, replacements };
}
/**
 * Add tags to a selected note, independent of a source tag.
 * Existing YAML tag fields are extended in-place. Otherwise tags are added to each
 * Markdown post containing inline tags; if the note has no inline tags, they are
 * appended to its final post. When forceYaml is true, a YAML tags property is created
 * when needed and all requested tags are stored in the frontmatter.
 */
function addTagsToMarkdownDocument(content, requestedTags, caseSensitive, inlineSourceTags = [], forceYaml = false) {
    const newTags = [];
    const seen = new Set();
    for (const value of requestedTags) {
        const tag = normalizeTag(value);
        if (!tag || !isValidTag(tag))
            continue;
        const key = tagKey(tag, caseSensitive);
        if (seen.has(key))
            continue;
        seen.add(key);
        newTags.push(tag);
    }
    if (newTags.length === 0)
        return { text: content, changed: false };

    const newline = detectNewline(content);
    const frontmatterMatch = matchFrontmatter(content);
    if (frontmatterMatch) {
        const { frontmatter } = frontmatterMatch;
        const afterFrontmatter = content.slice(frontmatterMatch.whole.length);
        let parsed;
        try {
            parsed = parseYaml(frontmatter);
        }
        catch {
            parsed = null;
        }
        if (frontmatter.trim() === "")
            parsed = {};
        let field = null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            if (Object.prototype.hasOwnProperty.call(parsed, "tags"))
                field = "tags";
            else if (Object.prototype.hasOwnProperty.call(parsed, "tag"))
                field = "tag";
        }
        if (field) {
            const replacements = new Map();
            const yamlResult = addTagsToFrontmatter(frontmatter, field, newTags, caseSensitive, {
                replacements,
                placeholderCache: new Map(),
                reservedTokens: new Set(newTags),
            });
            if (yamlResult.changed) {
                let resolved = `${joinFrontmatter(frontmatterMatch, yamlResult.text, newline)}${afterFrontmatter}`;
                for (const [placeholder, tag] of replacements)
                    resolved = resolved.split(placeholder).join(tag);
                return { text: resolved, changed: resolved !== content };
            }
            return { text: content, changed: false };
        }
        if (forceYaml && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const tagLines = newTags.map((tag) => `  - ${JSON.stringify(tag)}`).join(newline);
            const updatedFrontmatter = frontmatter.trim().length > 0
                ? `${frontmatter}${newline}tags:${newline}${tagLines}`
                : `tags:${newline}${tagLines}`;
            const resolved = `${joinFrontmatter(frontmatterMatch, updatedFrontmatter, newline)}${afterFrontmatter}`;
            return { text: resolved, changed: resolved !== content };
        }
    }

    if (forceYaml && !frontmatterMatch) {
        const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
        const body = bom ? content.slice(1) : content;
        const tagLines = newTags.map((tag) => `  - ${JSON.stringify(tag)}`).join(newline);
        const frontmatter = `${bom}---${newline}tags:${newline}${tagLines}${newline}---${newline}`;
        return { text: `${frontmatter}${body}`, changed: true };
    }

    const frontmatterLength = frontmatterMatch ? frontmatterMatch.whole.length : 0;
    const body = content.slice(frontmatterLength);
    const segments = splitMarkdownPostSegments(body);
    const sourceTags = [...new Set(inlineSourceTags.map((tag) => normalizeTag(tag)).filter(Boolean))];
    const targetPostIndices = new Set();
    if (sourceTags.length > 0) {
        let postIndex = -1;
        for (const part of segments) {
            if (part.type !== "post")
                continue;
            postIndex += 1;
            if (sourceTags.some((tag) => containsActiveMarkdownTag(part.text, tag, caseSensitive)))
                targetPostIndices.add(postIndex);
        }
    }
    if (targetPostIndices.size === 0) {
        // With no inline tags in the note, append to its last non-empty post.
        // This also keeps new tags before a trailing horizontal separator.
        let lastPostIndex = -1;
        let preferredPostIndex = -1;
        let postIndex = -1;
        for (const part of segments) {
            if (part.type !== "post")
                continue;
            postIndex += 1;
            lastPostIndex = postIndex;
            if (part.text.trim().length > 0)
                preferredPostIndex = postIndex;
        }
        const targetIndex = preferredPostIndex >= 0 ? preferredPostIndex : lastPostIndex;
        if (targetIndex >= 0)
            targetPostIndices.add(targetIndex);
    }

    let changed = false;
    let postIndex = -1;
    for (const part of segments) {
        if (part.type !== "post")
            continue;
        postIndex += 1;
        if (!targetPostIndices.has(postIndex))
            continue;
        const tagsToAdd = newTags.filter((tag) => !containsActiveMarkdownTag(part.text, tag, caseSensitive));
        if (tagsToAdd.length === 0)
            continue;
        const trailingNewlines = part.text.match(/(?:\r?\n)*$/)?.[0] ?? "";
        const core = part.text.slice(0, part.text.length - trailingNewlines.length);
        const tagLine = tagsToAdd.map((tag) => `#${tag}`).join(" ");
        if (core.trim().length === 0) {
            part.text = `${tagLine}${trailingNewlines}`;
        }
        else {
            part.text = `${core}${newline}${tagLine}${trailingNewlines}`;
        }
        changed = true;
    }
    return { text: `${content.slice(0, frontmatterLength)}${segments.map((part) => part.text).join("")}`, changed };
}

module.exports = { addTagsToMarkdown, addTagsToMarkdownDocument };
