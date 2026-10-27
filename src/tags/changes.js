"use strict";
/** Подготовка карты операций (rename / delete / unmark) по ключу тега. */
const { normalizeTag, tagKey } = require("./tag-name.js");

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

module.exports = { makeChangeMap };
