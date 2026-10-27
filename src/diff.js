"use strict";
/** Построчное сравнение «было → стало» для предпросмотра изменений. */

const MAX_LCS_CELLS = 4000000;

/**
 * Line diff. Common head and tail are trimmed first, so the quadratic LCS only
 * runs on the changed middle, which is tiny for tag edits.
 * @returns {{ type: "equal" | "del" | "add", text: string }[]}
 */
function diffLines(before, after) {
    const a = before.split(/\r?\n/);
    const b = after.split(/\r?\n/);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start])
        start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
    }
    const ops = a.slice(0, start).map((text) => ({ type: "equal", text }));
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    if (midA.length * midB.length > MAX_LCS_CELLS) {
        ops.push(...midA.map((text) => ({ type: "del", text })), ...midB.map((text) => ({ type: "add", text })));
    }
    else {
        const n = midA.length;
        const m = midB.length;
        const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
        for (let i = n - 1; i >= 0; i -= 1) {
            for (let j = m - 1; j >= 0; j -= 1)
                table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (midA[i] === midB[j]) {
                ops.push({ type: "equal", text: midA[i] });
                i += 1;
                j += 1;
            }
            else if (table[i + 1][j] >= table[i][j + 1]) {
                ops.push({ type: "del", text: midA[i++] });
            }
            else {
                ops.push({ type: "add", text: midB[j++] });
            }
        }
        while (i < n)
            ops.push({ type: "del", text: midA[i++] });
        while (j < m)
            ops.push({ type: "add", text: midB[j++] });
    }
    ops.push(...a.slice(endA).map((text) => ({ type: "equal", text })));
    return ops;
}

/** Group changes into hunks with `context` unchanged lines around them. */
function buildHunks(ops, context = 2) {
    const hunks = [];
    let current = null;
    let lastChange = -Infinity;
    let lineA = 0;
    let lineB = 0;
    ops.forEach((op, index) => {
        op.lineA = op.type === "add" ? null : ++lineA;
        op.lineB = op.type === "del" ? null : ++lineB;
        if (op.type !== "equal") {
            if (!current || index - lastChange > context * 2 + 1) {
                current = { ops: [] };
                hunks.push(current);
                for (let k = Math.max(0, index - context); k < index; k += 1) {
                    if (!current.ops.includes(ops[k]))
                        current.ops.push(ops[k]);
                }
            }
            else {
                for (let k = lastChange + 1; k < index; k += 1)
                    current.ops.push(ops[k]);
            }
            current.ops.push(op);
            lastChange = index;
        }
    });
    // Trailing context after the last change of each hunk.
    for (const hunk of hunks) {
        const last = hunk.ops[hunk.ops.length - 1];
        let index = ops.indexOf(last);
        for (let k = 1; k <= context && index + k < ops.length && ops[index + k].type === "equal"; k += 1) {
            if (!hunks.some((other) => other !== hunk && other.ops.includes(ops[index + k])))
                hunk.ops.push(ops[index + k]);
        }
    }
    return hunks;
}

/** Split a changed line pair into common prefix, changed middle and common suffix. */
function inlineChange(before, after) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
        prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix])
        suffix += 1;
    return {
        before: [before.slice(0, prefix), before.slice(prefix, before.length - suffix), before.slice(before.length - suffix)],
        after: [after.slice(0, prefix), after.slice(prefix, after.length - suffix), after.slice(after.length - suffix)],
    };
}

module.exports = { diffLines, buildHunks, inlineChange };
