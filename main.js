/*
 * Tag Refactor & Auditor 1.0.28 — точка входа Obsidian.
 *
 * Файл самодостаточен: код всех модулей из src/ встроен ниже без изменений,
 * поэтому для установки хватает main.js, manifest.json и styles.css.
 *
 * Если рядом с main.js лежит папка src/, модули загружаются из неё — так
 * правки в src/ работают сразу после перезагрузки плагина, без сборки.
 * Без src/ используются встроенные копии.
 */
"use strict";
const obsidian = require("obsidian");

const SOURCE_DIR = "src";
const ENTRY = "index.js";
const EMBEDDED_MODULES = Object.create(null);

function normalizeModulePath(path) {
    const parts = [];
    for (const part of path.split("/")) {
        if (part === "" || part === ".")
            continue;
        if (part === "..")
            parts.pop();
        else
            parts.push(part);
    }
    return parts.join("/");
}
function dirnameOf(id) {
    const index = id.lastIndexOf("/");
    return index < 0 ? "" : id.slice(0, index);
}

/** Read every .js file of the plugin's src/ folder (id -> source), or null when there is none. */
async function readSourceFolder(adapter, baseDir) {
    if (!(await adapter.exists(baseDir)))
        return null;
    const sources = new Map();
    const walk = async (dir) => {
        const listing = await adapter.list(dir);
        await Promise.all(listing.files
            .filter((path) => path.endsWith(".js"))
            .map(async (path) => {
                sources.set(path.slice(baseDir.length + 1), await adapter.read(path));
            }));
        for (const folder of listing.folders)
            await walk(folder);
    };
    await walk(baseDir);
    return sources.size > 0 ? sources : null;
}

/**
 * Minimal CommonJS loader. `resolveFactory(id)` returns the module function;
 * "obsidian" and other bare names come from the host `require`.
 */
function createModuleLoader(resolveFactory) {
    const cache = new Map();
    const load = (id) => {
        if (cache.has(id))
            return cache.get(id).exports;
        const factory = resolveFactory(id);
        if (!factory)
            throw new Error(`Модуль ${SOURCE_DIR}/${id} не найден.`);
        const module = { exports: {} };
        cache.set(id, module);
        const localRequire = (request) => request.startsWith(".")
            ? load(normalizeModulePath(`${dirnameOf(id)}/${request}`))
            : require(request);
        factory(module, module.exports, localRequire);
        return module.exports;
    };
    return load;
}
function fromSources(sources, pluginId) {
    return (id) => {
        const source = sources.get(id);
        if (source === undefined)
            return null;
        // sourceURL makes each module appear as its own file in the developer console.
        return new Function("module", "exports", "require", `${source}\n//# sourceURL=plugin:${pluginId}/${SOURCE_DIR}/${id}`);
    };
}

class TagRefactorAuditorPlugin extends obsidian.Plugin {
    async onload() {
        const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
        let sources = null;
        try {
            sources = await readSourceFolder(this.app.vault.adapter, `${pluginDir}/${SOURCE_DIR}`);
        }
        catch (error) {
            console.warn("Tag Refactor & Auditor: папку src/ прочитать не удалось, используются встроенные модули.", error);
        }
        try {
            const resolve = sources ? fromSources(sources, this.manifest.id) : (id) => EMBEDDED_MODULES[id] ?? null;
            createModuleLoader(resolve)(ENTRY).installPlugin(TagRefactorAuditorPlugin);
        }
        catch (error) {
            console.error("Tag Refactor & Auditor: не удалось загрузить модули", error);
            new obsidian.Notice(`Tag Refactor & Auditor: ошибка загрузки модулей${sources ? " из папки src/" : ""}.\n${error instanceof Error ? error.message : String(error)}`, 15000);
            return;
        }
        this.initState();
        await this.start();
    }
    onunload() {
        if (typeof this.stop === "function")
            this.stop();
    }
}

module.exports = TagRefactorAuditorPlugin;

/* Встроенные копии модулей src/ (используются, когда папки src/ нет). */
/* ===== src/constants.js ===== */
EMBEDDED_MODULES["constants.js"] = function (module, exports, require) {
"use strict";
/** Общие константы и настройки по умолчанию. */

const VIEW_TYPE = "tag-refactor-auditor-view";
const DEFAULT_SETTINGS = {
  previewChars: 400,
  caseSensitive: false,
  ignoredFolders: ["Templates"],
  createdDateProperty: "",
  // Used when createdDateProperty is empty: "ctime" (file created) or "mtime" (file modified).
  fileDateField: "ctime",
  minTagMentions: 0
};
// Frontmatter keys never offered as a date source.
const NON_DATE_PROPERTIES = new Set(["tags", "tag", "aliases", "alias", "cssclasses", "cssclass", "publish"]);
const PREVIEW_PAGE_SIZE = 8;
const BULK_PAGE_SIZE = 60;
const FILE_SELECT_PAGE_SIZE = 200;
// Tag catalog rows rendered per portion while scrolling.
const CATALOG_PAGE_SIZE = 250;

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS, NON_DATE_PROPERTIES, PREVIEW_PAGE_SIZE, BULK_PAGE_SIZE, FILE_SELECT_PAGE_SIZE, CATALOG_PAGE_SIZE };
};

/* ===== src/dates.js ===== */
EMBEDDED_MODULES["dates.js"] = function (module, exports, require) {
"use strict";
/** Разбор дат создания заметок из YAML (ISO, числовые форматы, названия месяцев на многих языках). */

const DATE_MONTH_ALIASES = new Map();
const DATE_MONTH_GROUPS = [
    // January / Janvier / Enero / Gennaio and related forms.
    ["january|jan|janvier|janv|enero|ene|janeiro|jane|gennaio|gen|januari|januar|ianuarie|styczeń|stycznia|stycz|leden|ledna|tammikuu|tammikuuta|январь|января|январе|янв|січень|січня|січ|студзень|студзеня|Ιανουάριος|Ιανουαρίου|يناير|มกราคม"],
    ["february|feb|février|fevrier|févr|fevr|febrero|feb|fevereiro|fev|febbraio|feb|februari|februar|februarie|luty|lutego|lut|únor|unor|února|unora|helmikuu|helmikuuta|февраль|февраля|феврале|фев|лютий|лютого|лют|люты|лютага|Φεβρουάριος|Φεβρουαρίου|فبراير|กุมภาพันธ์"],
    ["march|mar|mars|marzo|março|marco|maret|maart|märz|marz|marzec|marca|březen|brezen|března|brezna|maaliskuu|maaliskuuta|березень|березня|март|марта|марте|мар|сакавік|сакавіка|Μάρτιος|Μαρτίου|مارس|มีนาคม"],
    ["april|apr|avril|avr|abril|abr|aprile|kwiecień|kwiecien|kwietnia|kwie|duben|dubna|huhtikuu|huhtikuuta|апрель|апреля|апреле|апр|квітень|квітня|красавік|красавіка|nisan|Απρίλιος|Απριλίου|أبريل|ابريل|เมษายน"],
    ["may|mai|mayo|maio|maggio|mei|maj|maja|květen|kveten|května|kvetna|toukokuu|toukokuuta|травень|травня|май|мая|мае|mayıs|mayis|Μάιος|Μαΐου|مايو|พฤษภาคม"],
    ["june|jun|juin|juin|junio|junho|giugno|giu|juni|czerwiec|czerwca|cze|červen|cerven|června|cervna|kesäkuu|kesäkuuta|червень|червня|июнь|июня|июне|июн|haziran|Ιούνιος|Ιουνίου|يونيو|มิถุนายน"],
    ["july|jul|juillet|juil|julio|julho|luglio|lug|juli|lipiec|lipca|lip|červenec|cervenec|července|cervence|heinäkuu|heinäkuuta|липень|липня|июль|июля|июле|июл|temmuz|Ιούλιος|Ιουλίου|يوليو|กรกฎาคม"],
    ["august|aug|août|aout|agosto|ag|augustus|augustus|sierpień|sierpien|sierpnia|sie|srpen|srpna|elokuu|elokuuta|серпень|серпня|август|августа|августе|авг|ağustos|agustos|Αύγουστος|Αυγούστου|أغسطس|اغسطس|สิงหาคม"],
    ["september|sep|sept|septembre|septiembre|setiembre|set|setembro|settembre|wrzesień|wrzesien|września|wrzesnia|wrz|září|zari|syyskuu|syyskuuta|вересень|вересня|сентябрь|сентября|сентябре|сен|сент|eylül|eylul|Σεπτέμβριος|Σεπτεμβρίου|سبتمبر|กันยายน"],
    ["october|oct|octobre|oct|octubre|outubro|out|ottobre|oktober|okt|październik|pazdziernik|października|pazdziernika|paź|paz|říjen|rijen|října|rijna|lokakuu|lokakuuta|жовтень|жовтня|октябрь|октября|октябре|окт|ekim|Οκτώβριος|Οκτωβρίου|أكتوبر|اكتوبر|ตุลาคม"],
    ["november|nov|novembre|noviembre|novembro|nov|listopad|listopada|listopadu|lis|marraskuu|marraskuuta|листопад|листопада|ноябрь|ноября|ноябре|ноя|kasım|kasim|Νοέμβριος|Νοεμβρίου|نوفمبر|พฤศจิกายน"],
    ["december|dec|décembre|decembre|diciembre|dezembro|dez|dicembre|dic|december|dezember|dez|grudzień|grudzien|grudnia|gru|prosinec|prosince|joulukuu|joulukuuta|грудень|грудня|декабрь|декабря|декабре|дек|aralık|aralik|Δεκέμβριος|Δεκεμβρίου|ديسمبر|ธันวาคม"],
];
function normalizeDateToken(value) {
    return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.'’ʼ]/g, "").trim();
}
for (let monthIndex = 0; monthIndex < DATE_MONTH_GROUPS.length; monthIndex += 1) {
    for (const alias of DATE_MONTH_GROUPS[monthIndex][0].split("|")) {
        DATE_MONTH_ALIASES.set(normalizeDateToken(alias), monthIndex + 1);
    }
}
const THAI_MONTH_ALIASES = new Set(["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"].map(normalizeDateToken));
function normalizeLocalizedDigits(value) {
    return value.replace(/[٠-٩۰-۹]/g, (digit) => {
        const code = digit.codePointAt(0) ?? 0;
        const base = code >= 0x06f0 && code <= 0x06f9 ? 0x06f0 : 0x0660;
        return String(code - base);
    }).replace(/[۰-۹]/g, (digit) => String((digit.codePointAt(0) ?? 0) - 0x06f0));
}
function toUtcDateTimestamp(year, month, day) {
    if (!Number.isInteger(year) || year < 100 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31)
        return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
        return null;
    return date.getTime();
}
function expandTwoDigitYear(year) {
    if (year >= 100)
        return year;
    return year <= 49 ? 2000 + year : 1900 + year;
}
function parseCreationDate(value) {
    if (value instanceof Date)
        return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            return 0;
        if (Number.isInteger(value) && value >= 19000101 && value <= 29991231) {
            const raw = String(value);
            return toUtcDateTimestamp(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8))) ?? 0;
        }
        if (Math.abs(value) >= 1000000000000)
            return value;
        if (Math.abs(value) >= 1000000000)
            return value * 1000;
        return 0;
    }
    if (typeof value !== "string")
        return 0;
    let raw = normalizeLocalizedDigits(value).trim().replace(/[\u200e\u200f\u202a-\u202e]/g, "");
    if (!raw)
        return 0;
    raw = raw.replace(/^['"]|['"]$/g, "").trim();
    // ISO date/timestamp: deterministic across machines and locales.
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[Tt\s])/);
    if (iso) {
        const calendar = toUtcDateTimestamp(Number(iso[1]), Number(iso[2]), Number(iso[3]));
        if (calendar === null)
            return 0;
        const parsedTimestamp = Date.parse(raw);
        return Number.isFinite(parsedTimestamp) ? parsedTimestamp : calendar;
    }
    // Compact YYYYMMDD and year-first separated dates (YYYY/MM/DD, YYYY.MM.DD).
    if (/^\d{8}$/.test(raw)) {
        return toUtcDateTimestamp(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8))) ?? 0;
    }
    const ymd = raw.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})(?=$|[Tt\s])/);
    if (ymd) {
        return toUtcDateTimestamp(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])) ?? 0;
    }
    // East Asian year/month/day forms, such as 2012年10月12日 or 2012년 10월 12일.
    const eastAsian = raw.match(/^\s*(\d{4})\s*(?:年|년)\s*(\d{1,2})\s*(?:月|월)\s*(\d{1,2})\s*(?:日|일)?/);
    if (eastAsian) {
        return toUtcDateTimestamp(Number(eastAsian[1]), Number(eastAsian[2]), Number(eastAsian[3])) ?? 0;
    }
    // Numeric dates: dotted/hyphenated forms default to day-first; slash forms
    // default to month-first when both first components are <= 12 (common US style).
    const numeric = raw.match(/^\s*(\d{1,2})\s*([/.\-])\s*(\d{1,2})\s*\2\s*(\d{2,4})(?=$|[\s,Tt])/);
    if (numeric) {
        const first = Number(numeric[1]);
        const second = Number(numeric[3]);
        const year = expandTwoDigitYear(Number(numeric[4]));
        let month;
        let day;
        if (first > 12) {
            day = first;
            month = second;
        }
        else if (second > 12) {
            month = first;
            day = second;
        }
        else if (numeric[2] === "/") {
            month = first;
            day = second;
        }
        else {
            day = first;
            month = second;
        }
        return toUtcDateTimestamp(year, month, day) ?? 0;
    }
    // Textual month formats used across many locales: 12 октября 2012,
    // October 12, 2012, 12 octobre 2012, 12 de outubro de 2012, etc.
    // Drop a trailing time before extracting date components.
    const datePart = raw.replace(/[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?\s*$/i, "").trim();
    let month = 0;
    let thaiCalendar = false;
    for (const token of datePart.match(/[\p{L}\p{M}]+/gu) ?? []) {
        const normalizedToken = normalizeDateToken(token);
        const found = DATE_MONTH_ALIASES.get(normalizedToken);
        if (found) {
            month = found;
            thaiCalendar = THAI_MONTH_ALIASES.has(normalizedToken);
            break;
        }
    }
    if (month) {
        const numbers = [...datePart.matchAll(/\d{1,4}/g)].map((match) => ({ value: Number(match[0]), length: match[0].length }));
        if (numbers.length >= 2) {
            let yearEntry = numbers.find((item) => item.value >= 1000 && item.value <= 9999);
            if (!yearEntry) {
                const possibleYear = [...numbers].reverse().find((item) => item.length === 2 && item.value <= 99);
                if (possibleYear)
                    yearEntry = possibleYear;
            }
            if (yearEntry) {
                let year = expandTwoDigitYear(yearEntry.value);
                if (thaiCalendar && year >= 2400 && year <= 2700)
                    year -= 543;
                const dayEntry = numbers.find((item) => item !== yearEntry && item.value >= 1 && item.value <= 31);
                if (dayEntry) {
                    const parsed = toUtcDateTimestamp(year, month, dayEntry.value);
                    return parsed ?? 0;
                }
            }
        }
        return 0;
    }
    // Final fallback supports RFC-style strings and other formats understood by
    // the JavaScript engine; all common ambiguous formats above are handled first.
    const fallback = Date.parse(raw);
    return Number.isFinite(fallback) ? fallback : 0;
}
function getFrontmatterProperty(frontmatter, property) {
    if (!frontmatter || typeof frontmatter !== "object")
        return undefined;
    if (Object.prototype.hasOwnProperty.call(frontmatter, property))
        return frontmatter[property];
    return property.split(".").reduce((current, part) => {
        if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, part))
            return current[part];
        return undefined;
    }, frontmatter);
}

module.exports = { parseCreationDate, getFrontmatterProperty };
};

/* ===== src/diff.js ===== */
EMBEDDED_MODULES["diff.js"] = function (module, exports, require) {
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
};

/* ===== src/index.js ===== */
EMBEDDED_MODULES["index.js"] = function (module, exports, require) {
"use strict";
/** Сборка класса плагина из миксинов; вызывается загрузчиком в корневом main.js. */
const { BatchMixin } = require("./plugin/batch.js");
const { PluginCoreMixin } = require("./plugin/core.js");
const { QueueMixin } = require("./plugin/queue.js");
const { applyMixins } = require("./utils.js");

function installPlugin(PluginClass) {
    applyMixins(PluginClass, PluginCoreMixin, QueueMixin, BatchMixin);
}

module.exports = { installPlugin };
};

/* ===== src/modals/apply-confirm-modal.js ===== */
EMBEDDED_MODULES["modals/apply-confirm-modal.js"] = function (module, exports, require) {
"use strict";
/** Подтверждение применения очереди с выбором заметок, в которые вносятся изменения. */
const { Modal, Notice, setIcon } = require("obsidian");
const { tagKey } = require("../tags/tag-name.js");
const { pluralRu } = require("../utils.js");
const { FileReviewList } = require("./file-review-list.js");

class ApplyConfirmModal extends Modal {
    /**
     * @param files заметки, затронутые очередью; по умолчанию выбраны все.
     * @param onConfirm получает Set путей выбранных заметок.
     */
    constructor(app, plugin, changes, files, mergedTargets, onConfirm) {
        super(app);
        this.plugin = plugin;
        this.changes = changes;
        this.files = files;
        this.mergedTargets = mergedTargets;
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        this.modalEl?.addClass?.("tra-apply-modal");
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-modal-icon" });
        setIcon(icon, "shield-check");
        contentEl.createEl("h2", { text: "Применить изменения?" });
        const renameCount = this.changes.filter((change) => change.action === "rename").length;
        const deleteCount = this.changes.filter((change) => change.action === "delete" || (change.newTag === null && change.action !== "add")).length;
        const unmarkCount = this.changes.filter((change) => change.action === "unmark").length;
        const addCount = this.changes.filter((change) => change.action === "add").length;
        const actionSummary = [
            renameCount ? `${renameCount} ${pluralRu(renameCount, "переименование", "переименования", "переименований")}` : "",
            deleteCount ? `${deleteCount} ${pluralRu(deleteCount, "удаление тега", "удаления тега", "удалений тегов")}` : "",
            unmarkCount ? `${unmarkCount} ${pluralRu(unmarkCount, "снятие маркировки", "снятия маркировки", "снятий маркировки")}` : "",
            addCount ? `${addCount} ${pluralRu(addCount, "пакет добавления тегов", "пакета добавления тегов", "пакетов добавления тегов")}` : "",
        ].filter(Boolean).join(", ");
        const total = this.files.length;
        contentEl.createEl("p", { text: `Затронуто ${total} ${pluralRu(total, "заметка", "заметки", "заметок")}. ${actionSummary ? `В очереди: ${actionSummary}.` : ""}` });
        const changes = contentEl.createDiv({ cls: "tra-modal-changes" });
        for (const change of this.changes) {
            const row = changes.createDiv({ cls: "tra-modal-change" });
            row.createSpan({ text: `#${change.oldTag}` });
            if (change.action === "add") {
                const add = row.createSpan({ cls: "tra-modal-add" });
                setIcon(add, "plus");
                row.createSpan({ text: `Добавить ${change.addTags.map((tag) => `#${tag}`).join(" ")}` });
            }
            else if (change.action === "delete" || change.newTag === null) {
                const remove = row.createSpan({ cls: "tra-modal-delete" });
                setIcon(remove, "trash-2");
                row.createSpan({ text: "Удалить тег" });
            }
            else if (change.action === "unmark") {
                const unmark = row.createSpan({ cls: "tra-modal-unmark" });
                setIcon(unmark, "hash");
                row.createSpan({ text: "Оставить # как обычный текст" });
            }
            else {
                const arrow = row.createSpan({ cls: "tra-modal-arrow" });
                setIcon(arrow, "arrow-right");
                row.createSpan({ text: `#${change.newTag}` });
            }
        }
        if (this.mergedTargets.length > 0) {
            const warning = contentEl.createDiv({ cls: "tra-modal-warning" });
            const warningIcon = warning.createDiv();
            setIcon(warningIcon, "alert-triangle");
            const warningText = warning.createDiv();
            warningText.createEl("strong", { text: "Возможное объединение тегов" });
            warningText.createEl("p", { text: `Следующие целевые теги уже существуют или повторяются в очереди: ${this.mergedTargets.map((tag) => `#${tag}`).join(", ")}. Это объединит их статистику.` });
        }
        const caseSensitive = this.plugin.settings.caseSensitive;
        const sourceKeys = new Set(this.changes.map((change) => tagKey(change.oldTag, caseSensitive)));
        const transform = this.plugin.buildQueueTransform(this.changes);
        this.review = new FileReviewList(this.app, this.plugin, {
            files: this.files,
            preview: (file) => this.plugin.previewTransform(file, transform),
            chipTags: (file) => this.plugin.getTagsForFile(file).filter((tag) => sourceKeys.has(tagKey(tag, caseSensitive))),
            highlightTag: this.changes.length === 1 ? this.changes[0].oldTag : undefined,
            onChange: () => this.syncConfirm(),
        });
        this.review.render(contentEl);
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        const cancel = actions.createEl("button", { cls: "tra-secondary-button", text: "Отмена", attr: { type: "button" } });
        cancel.addEventListener("click", () => this.close());
        const confirm = actions.createEl("button", { cls: "tra-primary-button tra-apply-confirm", attr: { type: "button" } });
        this.confirmButton = confirm;
        confirm.addEventListener("click", async () => {
            if (this.review.selectedPaths.size === 0)
                return;
            confirm.disabled = true;
            confirm.setText("Обработка…");
            try {
                await this.onConfirm(new Set(this.review.selectedPaths));
                this.close();
            }
            catch (error) {
                new Notice(`Не удалось применить изменения: ${error instanceof Error ? error.message : String(error)}`, 8000);
                confirm.disabled = false;
                confirm.setText("Повторить");
            }
        });
        this.syncConfirm();
    }
    syncConfirm() {
        const confirm = this.confirmButton;
        if (!confirm || !this.review || confirm.textContent === "Обработка…")
            return;
        const selected = this.review.selectedPaths.size;
        const total = this.files.length;
        confirm.disabled = selected === 0;
        confirm.setText(selected === total
            ? "Применить ко всем"
            : `Применить к ${selected} ${pluralRu(selected, "заметке", "заметкам", "заметкам")}`);
    }
    onClose() {
        this.contentEl.empty();
    }
}

module.exports = { ApplyConfirmModal };
};

/* ===== src/modals/batch-report-modal.js ===== */
EMBEDDED_MODULES["modals/batch-report-modal.js"] = function (module, exports, require) {
"use strict";
/** Отчёт о пакетной операции и кнопка отмены. */
const { Modal, setIcon } = require("obsidian");

class BatchReportModal extends Modal {
    constructor(app, plugin, report, isUndoReport = false) {
        super(app);
        this.plugin = plugin;
        this.report = report;
        this.isUndoReport = isUndoReport;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-report-icon" });
        setIcon(icon, this.isUndoReport ? "history" : this.report.errors.length > 0 ? "alert-circle" : "check-circle-2");
        contentEl.createEl("h2", { text: this.isUndoReport ? "Отмена завершена" : "Результат рефакторинга" });
        const stats = contentEl.createDiv({ cls: "tra-report-stats" });
        this.createReportStat(stats, "Изменено", String(this.report.updatedFiles), "check");
        this.createReportStat(stats, this.isUndoReport ? "Пропущено" : "Без изменений", String(this.report.unchangedFiles), "minus");
        this.createReportStat(stats, "Ошибки", String(this.report.errors.length), "alert-triangle");
        if (!this.isUndoReport && this.report.mergedTargets.length > 0) {
            contentEl.createEl("p", { cls: "tra-report-note", text: `Объединённые цели: ${this.report.mergedTargets.map((tag) => `#${tag}`).join(", ")}` });
        }
        for (const note of this.report.notes ?? [])
            contentEl.createEl("p", { cls: "tra-report-note", text: note });
        if (this.report.errors.length > 0) {
            const errorList = contentEl.createDiv({ cls: "tra-error-list" });
            errorList.createEl("strong", { text: "Файлы с ошибками" });
            for (const error of this.report.errors)
                errorList.createEl("div", { text: error });
        }
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        if (!this.isUndoReport && this.plugin.lastUndo.size > 0) {
            const undo = actions.createEl("button", { cls: "tra-secondary-button", text: "Отменить операцию" });
            undo.addEventListener("click", () => {
                this.close();
                void this.plugin.undoLastBatch();
            });
        }
        const close = actions.createEl("button", { cls: "tra-primary-button", text: "Готово" });
        close.addEventListener("click", () => this.close());
    }
    createReportStat(parent, label, value, iconName) {
        const item = parent.createDiv({ cls: "tra-report-stat" });
        const icon = item.createDiv();
        setIcon(icon, iconName);
        item.createDiv({ cls: "tra-report-value", text: value });
        item.createDiv({ cls: "tra-report-label", text: label });
    }
    onClose() {
        this.contentEl.empty();
    }
}

module.exports = { BatchReportModal };
};

/* ===== src/modals/bulk-apply-confirm-modal.js ===== */
EMBEDDED_MODULES["modals/bulk-apply-confirm-modal.js"] = function (module, exports, require) {
"use strict";
/** Подтверждение массовой операции на вкладке «Заметки по датам» с выбором заметок и предпросмотром изменений. */
const { Modal, Notice, setIcon } = require("obsidian");
const { pluralRu } = require("../utils.js");
const { FileReviewList } = require("./file-review-list.js");

class BulkApplyConfirmModal extends Modal {
    /**
     * @param options.files        выбранные заметки
     * @param options.title        название операции
     * @param options.details      описание операции
     * @param options.isDestructive показывать предупреждение
     * @param options.transform    (file, content) => content — для предпросмотра
     * @param options.onConfirm    async (selectedFiles) => void
     */
    constructor(app, plugin, options) {
        super(app);
        this.plugin = plugin;
        this.options = options;
    }
    onOpen() {
        const { contentEl } = this;
        const { files, title, details, isDestructive, transform } = this.options;
        this.modalEl?.addClass?.("tra-apply-modal");
        contentEl.addClass("tra-modal");
        const icon = contentEl.createDiv({ cls: "tra-modal-icon" });
        setIcon(icon, isDestructive ? "alert-triangle" : "layers");
        contentEl.createEl("h2", { text: "Применить массовые изменения?" });
        contentEl.createEl("p", { text: `Выбрано ${files.length} ${pluralRu(files.length, "заметка", "заметки", "заметок")}. Здесь можно ещё раз сузить выбор и посмотреть изменения в каждой заметке.` });
        const summary = contentEl.createDiv({ cls: "tra-bulk-confirm-summary" });
        summary.createEl("strong", { text: title });
        summary.createEl("p", { text: details });
        if (isDestructive) {
            const warning = contentEl.createDiv({ cls: "tra-modal-warning" });
            setIcon(warning.createDiv(), "alert-triangle");
            warning.createDiv({ text: "Будут изменены только выбранные заметки. После применения пакет можно отменить, если файлы не изменились повторно." });
        }
        this.review = new FileReviewList(this.app, this.plugin, {
            files,
            preview: (file) => this.plugin.previewTransform(file, transform),
            chipTags: (file) => this.plugin.getTagsForFile(file),
            onChange: () => this.syncConfirm(),
        });
        this.review.render(contentEl);
        const actions = contentEl.createDiv({ cls: "tra-modal-actions" });
        const cancel = actions.createEl("button", { cls: "tra-secondary-button", text: "Отмена", attr: { type: "button" } });
        cancel.addEventListener("click", () => this.close());
        const confirm = actions.createEl("button", { cls: "tra-primary-button tra-apply-confirm", attr: { type: "button" } });
        this.confirmButton = confirm;
        confirm.addEventListener("click", async () => {
            const selected = files.filter((file) => this.review.selectedPaths.has(file.path));
            if (selected.length === 0)
                return;
            confirm.disabled = true;
            confirm.setText("Обработка…");
            try {
                await this.options.onConfirm(selected);
                this.close();
            }
            catch (error) {
                new Notice(`Не удалось применить массовые изменения: ${error instanceof Error ? error.message : String(error)}`, 8000);
                confirm.disabled = false;
                confirm.setText("Повторить");
            }
        });
        this.syncConfirm();
    }
    syncConfirm() {
        const confirm = this.confirmButton;
        if (!confirm || !this.review || confirm.textContent === "Обработка…")
            return;
        const selected = this.review.selectedPaths.size;
        const total = this.options.files.length;
        confirm.disabled = selected === 0;
        confirm.setText(selected === total
            ? "Применить ко всем"
            : `Применить к ${selected} ${pluralRu(selected, "заметке", "заметкам", "заметкам")}`);
    }
    onClose() {
        this.contentEl.empty();
    }
}

module.exports = { BulkApplyConfirmModal };
};

/* ===== src/modals/file-review-list.js ===== */
EMBEDDED_MODULES["modals/file-review-list.js"] = function (module, exports, require) {
"use strict";
/**
 * Список заметок в окнах подтверждения: галочки, фильтр, «Выбрать все / Снять все»,
 * просмотр заметки и построчный предпросмотр изменений «было → стало».
 */
const { setIcon } = require("obsidian");
const { FILE_SELECT_PAGE_SIZE } = require("../constants.js");
const { buildHunks, diffLines, inlineChange } = require("../diff.js");
const { pluralRu } = require("../utils.js");
const { NotePreviewModal } = require("./note-preview-modal.js");

const MAX_HUNKS = 20;

/** Render a before/after diff of one note into `container`. Returns { added, removed }. */
function renderDiff(container, before, after) {
    container.empty();
    const ops = diffLines(before, after);
    const hunks = buildHunks(ops, 2);
    const added = ops.filter((op) => op.type === "add").length;
    const removed = ops.filter((op) => op.type === "del").length;
    if (hunks.length === 0) {
        container.createDiv({ cls: "tra-diff-empty", text: "Заметка не изменится." });
        return { added, removed };
    }
    for (const hunk of hunks.slice(0, MAX_HUNKS)) {
        const hunkEl = container.createDiv({ cls: "tra-diff-hunk" });
        const list = hunk.ops;
        for (let i = 0; i < list.length; i += 1) {
            const op = list[i];
            if (op.type === "del") {
                // Pair a run of removed lines with the following run of added lines
                // to highlight what changed inside each line.
                let delEnd = i;
                while (delEnd < list.length && list[delEnd].type === "del")
                    delEnd += 1;
                let addEnd = delEnd;
                while (addEnd < list.length && list[addEnd].type === "add")
                    addEnd += 1;
                const dels = list.slice(i, delEnd);
                const adds = list.slice(delEnd, addEnd);
                const paired = dels.length === adds.length;
                dels.forEach((del, k) => renderLine(hunkEl, del, paired ? inlineChange(del.text, adds[k].text).before : null));
                adds.forEach((add, k) => renderLine(hunkEl, add, paired ? inlineChange(dels[k].text, add.text).after : null));
                i = addEnd - 1;
                continue;
            }
            renderLine(hunkEl, op, null);
        }
    }
    if (hunks.length > MAX_HUNKS)
        container.createDiv({ cls: "tra-diff-more", text: `…и ещё ${hunks.length - MAX_HUNKS} ${pluralRu(hunks.length - MAX_HUNKS, "фрагмент", "фрагмента", "фрагментов")} изменений` });
    return { added, removed };
}
function renderLine(parent, op, parts) {
    const cls = op.type === "add" ? "is-add" : op.type === "del" ? "is-del" : "is-context";
    const line = parent.createDiv({ cls: `tra-diff-line ${cls}` });
    line.createSpan({ cls: "tra-diff-num", text: String((op.type === "add" ? op.lineB : op.lineA) ?? "") });
    line.createSpan({ cls: "tra-diff-sign", text: op.type === "add" ? "+" : op.type === "del" ? "−" : " " });
    const text = line.createSpan({ cls: "tra-diff-text" });
    if (parts && parts[1]) {
        text.appendText(parts[0]);
        text.createEl("mark", { cls: "tra-diff-change", text: parts[1] });
        text.appendText(parts[2]);
    }
    else {
        text.setText(op.text === "" ? " " : op.text);
    }
}

class FileReviewList {
    /**
     * @param options.files       заметки; по умолчанию выбраны все
     * @param options.preview     async (file) => { before, after } — без записи на диск
     * @param options.chipTags    (file) => string[] — теги, показываемые у заметки
     * @param options.highlightTag тег для подсветки в окне просмотра
     * @param options.onChange    () => void — при изменении выбора
     */
    constructor(app, plugin, options) {
        this.app = app;
        this.plugin = plugin;
        this.options = options;
        this.files = options.files;
        this.selectedPaths = new Set(this.files.map((file) => file.path));
        this.filter = "";
        this.renderLimit = FILE_SELECT_PAGE_SIZE;
        this.openDiffs = new Set();
        this.diffStats = new Map();
    }
    render(parent) {
        const section = parent.createDiv({ cls: "tra-apply-files" });
        const header = section.createDiv({ cls: "tra-apply-files-header" });
        header.createEl("strong", { text: "Заметки для изменения" });
        this.countEl = header.createSpan({ cls: "tra-apply-files-count" });
        const toolbar = section.createDiv({ cls: "tra-apply-files-toolbar" });
        const filterInput = toolbar.createEl("input", {
            cls: "tra-apply-files-filter",
            attr: { type: "text", placeholder: "Фильтр по названию или пути…", "aria-label": "Фильтр заметок", spellcheck: "false" },
        });
        this.selectAllButton = toolbar.createEl("button", { cls: "tra-secondary-button tra-apply-select-all", attr: { type: "button" } });
        this.selectNoneButton = toolbar.createEl("button", { cls: "tra-secondary-button tra-apply-select-none", attr: { type: "button" } });
        this.diffAllButton = toolbar.createEl("button", { cls: "tra-secondary-button tra-apply-diff-all", attr: { type: "button" } });
        this.listEl = section.createDiv({ cls: "tra-apply-files-list" });
        filterInput.addEventListener("input", () => {
            this.filter = filterInput.value.trim().toLocaleLowerCase();
            this.renderLimit = FILE_SELECT_PAGE_SIZE;
            this.renderRows();
        });
        // «Выбрать все» / «Снять все» действуют на заметки, видимые с учётом фильтра.
        this.selectAllButton.addEventListener("click", () => {
            for (const file of this.visibleFiles())
                this.selectedPaths.add(file.path);
            this.sync();
        });
        this.selectNoneButton.addEventListener("click", () => {
            for (const file of this.visibleFiles())
                this.selectedPaths.delete(file.path);
            this.sync();
        });
        this.diffAllButton.addEventListener("click", () => {
            const rows = Array.from(this.listEl.querySelectorAll(".tra-apply-file"));
            const open = rows.length > 0 && rows.every((row) => this.openDiffs.has(row.getAttribute("data-path")));
            for (const row of rows)
                this.setDiffOpen(row, !open);
            this.sync();
        });
        this.renderRows();
    }
    visibleFiles() {
        if (!this.filter)
            return this.files;
        return this.files.filter((file) => file.path.toLocaleLowerCase().includes(this.filter));
    }
    renderRows() {
        this.listEl.empty();
        const files = this.visibleFiles();
        if (files.length === 0)
            this.listEl.createDiv({ cls: "tra-apply-files-empty", text: "Нет заметок, подходящих под фильтр." });
        else
            this.appendRows(files, 0, Math.min(files.length, this.renderLimit));
        this.sync();
    }
    appendRows(files, from, to) {
        for (const file of files.slice(from, to)) {
            const wrapper = this.listEl.createDiv({ cls: "tra-apply-file", attr: { "data-path": file.path } });
            const row = wrapper.createDiv({ cls: "tra-apply-file-row", attr: { title: "Выбрать или снять выбор" } });
            const checkbox = row.createEl("input", { attr: { type: "checkbox", "aria-label": `Изменять ${file.basename}` } });
            checkbox.checked = this.selectedPaths.has(file.path);
            checkbox.addEventListener("click", (event) => event.stopPropagation());
            checkbox.addEventListener("change", () => this.setSelected(file.path, checkbox.checked));
            row.addEventListener("click", (event) => {
                if (event.target instanceof Element && event.target.closest("button"))
                    return;
                this.setSelected(file.path, !this.selectedPaths.has(file.path));
            });
            const text = row.createDiv({ cls: "tra-apply-file-text" });
            text.createDiv({ cls: "tra-apply-file-name", text: file.basename });
            text.createDiv({ cls: "tra-apply-file-path", text: file.path });
            const tags = row.createDiv({ cls: "tra-apply-file-tags" });
            for (const tag of this.options.chipTags?.(file) ?? [])
                tags.createSpan({ cls: "tra-bulk-tag-chip", text: `#${tag}` });
            row.createSpan({ cls: "tra-apply-file-stat" });
            const diffButton = row.createEl("button", { cls: "tra-apply-file-diff", attr: { type: "button", title: "Показать изменения", "aria-label": `Изменения в ${file.basename}` } });
            setIcon(diffButton, "file-diff");
            diffButton.addEventListener("click", () => {
                this.setDiffOpen(wrapper, !this.openDiffs.has(file.path));
                this.sync();
            });
            const open = row.createEl("button", { cls: "tra-apply-file-open", attr: { type: "button", title: "Просмотреть заметку", "aria-label": `Просмотреть ${file.basename}` } });
            setIcon(open, "eye");
            open.addEventListener("click", () => {
                new NotePreviewModal(this.app, file, {
                    plugin: this.plugin,
                    highlightTag: this.options.highlightTag,
                    selection: {
                        isSelected: () => this.selectedPaths.has(file.path),
                        toggle: () => this.setSelected(file.path, !this.selectedPaths.has(file.path)),
                    },
                }).open();
            });
            wrapper.createDiv({ cls: "tra-review-diff" });
            if (this.openDiffs.has(file.path))
                this.setDiffOpen(wrapper, true);
            this.updateStat(wrapper);
        }
        if (to < files.length) {
            const more = this.listEl.createEl("button", {
                cls: "tra-show-more",
                text: `Показать ещё ${Math.min(FILE_SELECT_PAGE_SIZE, files.length - to)} из ${files.length - to}`,
                attr: { type: "button" },
            });
            more.addEventListener("click", () => {
                more.remove();
                this.renderLimit = Math.min(files.length, to + FILE_SELECT_PAGE_SIZE);
                this.appendRows(files, to, this.renderLimit);
                this.sync();
            });
        }
    }
    setSelected(path, selected) {
        if (selected)
            this.selectedPaths.add(path);
        else
            this.selectedPaths.delete(path);
        this.sync();
    }
    setDiffOpen(wrapper, open) {
        const path = wrapper.getAttribute("data-path");
        const panel = wrapper.querySelector(".tra-review-diff");
        if (!panel)
            return;
        wrapper.classList.toggle("is-diff-open", open);
        if (!open) {
            this.openDiffs.delete(path);
            panel.empty();
            return;
        }
        this.openDiffs.add(path);
        const file = this.files.find((candidate) => candidate.path === path);
        panel.empty();
        panel.createDiv({ cls: "tra-diff-empty", text: "Вычисляю изменения…" });
        void this.options.preview(file).then(({ before, after }) => {
            if (!this.openDiffs.has(path) || !panel.isConnected && !wrapper.parentElement)
                return;
            this.diffStats.set(path, renderDiff(panel, before, after));
            this.updateStat(wrapper);
        }).catch((error) => {
            panel.empty();
            panel.createDiv({ cls: "tra-diff-error", text: `Не удалось подготовить изменения: ${error instanceof Error ? error.message : String(error)}` });
        });
    }
    updateStat(wrapper) {
        const stat = this.diffStats.get(wrapper.getAttribute("data-path"));
        const el = wrapper.querySelector(".tra-apply-file-stat");
        if (!el)
            return;
        el.empty();
        if (!stat)
            return;
        if (stat.added === 0 && stat.removed === 0) {
            el.setText("без изменений");
            return;
        }
        el.createSpan({ cls: "is-add", text: `+${stat.added}` });
        el.createSpan({ cls: "is-del", text: ` −${stat.removed}` });
    }
    sync() {
        const selected = this.selectedPaths.size;
        const total = this.files.length;
        this.countEl?.setText(`Выбрано ${selected} из ${total}`);
        const visible = this.visibleFiles();
        const visibleSelected = visible.filter((file) => this.selectedPaths.has(file.path)).length;
        const suffix = this.filter ? ` (${visible.length})` : "";
        if (this.selectAllButton) {
            this.selectAllButton.setText(`Выбрать все${suffix}`);
            this.selectAllButton.disabled = visibleSelected === visible.length;
        }
        if (this.selectNoneButton) {
            this.selectNoneButton.setText(`Снять все${suffix}`);
            this.selectNoneButton.disabled = visibleSelected === 0;
        }
        if (this.diffAllButton) {
            const rows = Array.from(this.listEl?.querySelectorAll(".tra-apply-file") ?? []);
            const allOpen = rows.length > 0 && rows.every((row) => this.openDiffs.has(row.getAttribute("data-path")));
            this.diffAllButton.setText(allOpen ? "Скрыть изменения" : "Показать изменения");
            this.diffAllButton.disabled = rows.length === 0;
        }
        for (const wrapper of Array.from(this.listEl?.querySelectorAll(".tra-apply-file") ?? [])) {
            const path = wrapper.getAttribute("data-path");
            const isSelected = this.selectedPaths.has(path);
            const input = wrapper.querySelector(".tra-apply-file-row input");
            if (input)
                input.checked = isSelected;
            wrapper.classList.toggle("is-selected", isSelected);
        }
        this.options.onChange?.();
    }
}

module.exports = { FileReviewList, renderDiff };
};

/* ===== src/modals/note-preview-modal.js ===== */
EMBEDDED_MODULES["modals/note-preview-modal.js"] = function (module, exports, require) {
"use strict";
/** Просмотр заметки в окне по центру экрана с затемнением фона. */
const { Component, MarkdownRenderer, Modal, setIcon } = require("obsidian");
const { extractNoteTags } = require("../tags/extract.js");
const { containsActiveMarkdownTag } = require("../tags/markdown.js");
const { listPosts } = require("../tags/posts.js");
const { stripFrontmatter } = require("../tags/frontmatter.js");
const { tagKey } = require("../tags/tag-name.js");
const { highlightTagInElement } = require("../utils.js");

class NotePreviewModal extends Modal {
    /**
     * @param options.plugin     плагин (теги заметки, дата, регистр)
     * @param options.highlightTag тег, который подсвечивается и к которому прокручивается окно
     * @param options.selection  { isSelected(): boolean, toggle(): void } — если задан,
     *                           в окне есть переключатель «Изменять эту заметку»
     * @param options.posts      { get(): {indices, count} | null, set(value | null): void } — если задан
     *                           и в заметке несколько записей (разделитель ---), их можно выбрать по отдельности
     */
    constructor(app, file, options = {}) {
        super(app);
        this.file = file;
        this.options = options;
        this.component = null;
    }
    onOpen() {
        const { contentEl, file } = this;
        const plugin = this.options.plugin;
        this.modalEl?.addClass?.("tra-note-modal");
        contentEl.addClass("tra-modal", "tra-note-preview");

        const header = contentEl.createDiv({ cls: "tra-note-header" });
        const titleWrap = header.createDiv({ cls: "tra-note-title-wrap" });
        titleWrap.createEl("h2", { cls: "tra-note-title", text: file.basename });
        titleWrap.createDiv({ cls: "tra-note-path", text: file.path });
        const meta = titleWrap.createDiv({ cls: "tra-note-meta" });
        if (plugin) {
            const created = plugin.getNoteCreationTimestamp(file);
            meta.createSpan({ cls: "tra-note-date", text: created ? `${new Date(created).toLocaleDateString()} · ${plugin.describeDateSource()}` : `Нет даты (${plugin.describeDateSource()})` });
        }
        // Filled from the note's own text in renderBody(), so every tag is shown
        // even for ignored folders or a stale index.
        this.tagsEl = titleWrap.createDiv({ cls: "tra-note-tags" });
        this.tagsEl.createSpan({ cls: "tra-note-tags-label", text: "Теги: загрузка…" });
        const actions = header.createDiv({ cls: "tra-note-actions" });
        const selection = this.options.selection;
        if (selection) {
            const label = actions.createEl("label", { cls: "tra-note-select" });
            const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
            checkbox.checked = selection.isSelected();
            label.createSpan({ text: "Изменять эту заметку" });
            this.noteCheckbox = checkbox;
            checkbox.addEventListener("change", () => {
                if (checkbox.checked !== selection.isSelected())
                    selection.toggle();
                checkbox.checked = selection.isSelected();
                // Re-selecting the whole note starts again with all of its records.
                this.options.posts?.set(null);
                this.syncPosts();
            });
        }
        const openButton = actions.createEl("button", { cls: "tra-secondary-button", attr: { type: "button", title: "Открыть заметку в новой вкладке" } });
        setIcon(openButton.createSpan({ cls: "tra-button-icon" }), "external-link");
        openButton.createSpan({ text: "Открыть во вкладке" });
        openButton.addEventListener("click", () => {
            this.close();
            void this.app.workspace.getLeaf("tab").openFile(file);
        });

        const body = contentEl.createDiv({ cls: "tra-note-body markdown-rendered", text: "Загрузка…" });
        // Internal links inside the preview open the linked note in a new tab.
        body.addEventListener("click", (event) => {
            const link = event.target instanceof Element ? event.target.closest("a.internal-link") : null;
            if (!link)
                return;
            event.preventDefault();
            const href = link.getAttribute("data-href") ?? link.getAttribute("href");
            if (href) {
                this.close();
                void this.app.workspace.openLinkText(href, file.path, "tab");
            }
        });
        this.component = new Component();
        this.component.load();
        void this.renderBody(body);
    }
    async renderBody(body) {
        try {
            const raw = await this.app.vault.cachedRead(this.file);
            if (!body.isConnected && !this.contentEl.contains(body))
                return;
            this.renderTags(raw);
            body.empty();
            const { posts, count } = listPosts(raw);
            if (this.options.posts && posts.filter((post) => !post.isEmpty).length > 1) {
                await this.renderPosts(body, posts, count);
                return;
            }
            const markdown = stripFrontmatter(raw).trim();
            if (!markdown) {
                body.createDiv({ cls: "tra-bulk-excerpt-empty", text: "Пустая заметка" });
                return;
            }
            await MarkdownRenderer.render(this.app, markdown, body, this.file.path, this.component);
            const tag = this.options.highlightTag;
            if (tag && this.options.plugin) {
                highlightTagInElement(body, tag, this.options.plugin.settings.caseSensitive);
                body.querySelector("mark.tra-highlight")?.scrollIntoView({ block: "center" });
            }
        }
        catch (error) {
            body.setText(`Не удалось прочитать заметку: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** Each record separately, with a checkbox: changes then touch only the checked records. */
    async renderPosts(body, posts, count) {
        const control = this.options.posts;
        const meaningful = posts.filter((post) => !post.isEmpty).map((post) => post.index);
        this.postState = { control, meaningful, count };
        const bar = body.createDiv({ cls: "tra-post-bar" });
        this.postCountEl = bar.createSpan({ cls: "tra-post-count" });
        const all = bar.createEl("button", { cls: "tra-secondary-button tra-post-all", attr: { type: "button" }, text: "Все записи" });
        const none = bar.createEl("button", { cls: "tra-secondary-button tra-post-none", attr: { type: "button" }, text: "Снять все" });
        bar.createSpan({ cls: "tra-note-selection-hint", text: "Изменения затронут только отмеченные записи. Шапка записи — выбрать." });
        all.addEventListener("click", () => this.updatePosts(new Set(meaningful)));
        none.addEventListener("click", () => this.updatePosts(new Set()));
        const caseSensitive = this.options.plugin?.settings.caseSensitive ?? false;
        const tag = this.options.highlightTag;
        let number = 0;
        for (const post of posts) {
            if (post.isEmpty)
                continue;
            number += 1;
            const block = body.createDiv({ cls: "tra-post", attr: { "data-index": String(post.index) } });
            const head = block.createDiv({ cls: "tra-post-head", attr: { title: "Выбрать или снять выбор записи" } });
            const checkbox = head.createEl("input", { cls: "tra-post-check", attr: { type: "checkbox", "aria-label": `Изменять запись ${number}` } });
            head.createSpan({ cls: "tra-post-title", text: `Запись ${number} из ${meaningful.length}` });
            if (tag && containsActiveMarkdownTag(post.text, tag, caseSensitive))
                head.createSpan({ cls: "tra-post-tag", text: `#${tag}` });
            head.addEventListener("click", (event) => {
                if (event.target === checkbox)
                    return;
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change"));
            });
            checkbox.addEventListener("change", () => {
                const current = this.currentPosts();
                if (checkbox.checked)
                    current.add(post.index);
                else
                    current.delete(post.index);
                this.updatePosts(current);
            });
            const content = block.createDiv({ cls: "tra-post-content markdown-rendered" });
            await MarkdownRenderer.render(this.app, post.text.trim(), content, this.file.path, this.component);
            if (tag)
                highlightTagInElement(content, tag, caseSensitive);
        }
        this.syncPosts();
        body.querySelector("mark.tra-highlight")?.scrollIntoView({ block: "center" });
    }
    currentPosts() {
        const { control, meaningful, count } = this.postState;
        const selection = control.get();
        if (!this.options.selection?.isSelected?.() && this.options.selection)
            return new Set();
        return selection && selection.count === count ? new Set(selection.indices) : new Set(meaningful);
    }
    updatePosts(indices) {
        const { control, meaningful, count } = this.postState;
        const selection = this.options.selection;
        if (indices.size === 0) {
            control.set(null);
            if (selection?.isSelected())
                selection.toggle();
        }
        else {
            control.set(indices.size === meaningful.length ? null : { indices: [...indices].sort((a, b) => a - b), count, meaningful: meaningful.length });
            if (selection && !selection.isSelected())
                selection.toggle();
        }
        if (this.noteCheckbox && selection)
            this.noteCheckbox.checked = selection.isSelected();
        this.syncPosts();
    }
    syncPosts() {
        if (!this.postState)
            return;
        const current = this.currentPosts();
        const total = this.postState.meaningful.length;
        this.postCountEl?.setText(`Записи: выбрано ${current.size} из ${total}`);
        for (const block of Array.from(this.contentEl.querySelectorAll(".tra-post"))) {
            const index = Number(block.getAttribute("data-index"));
            const checked = current.has(index);
            block.classList.toggle("is-excluded", !checked);
            const checkbox = block.querySelector(".tra-post-check");
            if (checkbox)
                checkbox.checked = checked;
        }
        const all = this.contentEl.querySelector(".tra-post-all");
        if (all)
            all.disabled = current.size === total;
        const none = this.contentEl.querySelector(".tra-post-none");
        if (none)
            none.disabled = current.size === 0;
    }
    renderTags(raw) {
        const el = this.tagsEl;
        if (!el)
            return;
        el.empty();
        const plugin = this.options.plugin;
        const caseSensitive = plugin?.settings.caseSensitive ?? false;
        const { yaml, inline, all } = extractNoteTags(raw, caseSensitive);
        // Tags known to the metadata cache but not found in the text (unusual
        // syntax) are still listed, so nothing the vault counts is hidden.
        const cache = this.app.metadataCache.getFileCache(this.file);
        const seen = new Set(all.map((tag) => tagKey(tag, caseSensitive)));
        for (const cached of cache?.tags ?? []) {
            const tag = cached.tag.replace(/^#/, "");
            const key = tagKey(tag, caseSensitive);
            if (tag && !seen.has(key)) {
                seen.add(key);
                all.push(tag);
                inline.push(tag);
            }
        }
        el.createSpan({ cls: "tra-note-tags-label", text: all.length ? `Теги (${all.length}):` : "Тегов нет" });
        const yamlKeys = new Set(yaml.map((tag) => tagKey(tag, caseSensitive)));
        const inlineKeys = new Set(inline.map((tag) => tagKey(tag, caseSensitive)));
        const highlightKey = this.options.highlightTag ? tagKey(this.options.highlightTag, caseSensitive) : null;
        for (const tag of all) {
            const key = tagKey(tag, caseSensitive);
            const inYaml = yamlKeys.has(key);
            const inText = inlineKeys.has(key);
            const chip = el.createSpan({
                cls: `tra-note-tag${key === highlightKey ? " is-current" : ""}${inYaml ? " is-yaml" : ""}`,
                attr: { title: inYaml && inText ? "В свойствах YAML и в тексте" : inYaml ? "В свойствах YAML" : "В тексте заметки" },
            });
            chip.createSpan({ cls: "tra-note-tag-name", text: `#${tag}` });
            if (inYaml)
                chip.createSpan({ cls: "tra-note-tag-source", text: inText ? "YAML + текст" : "YAML" });
        }
    }
    onClose() {
        this.component?.unload();
        this.component = null;
        this.contentEl.empty();
    }
}

module.exports = { NotePreviewModal };
};

/* ===== src/plugin/batch.js ===== */
EMBEDDED_MODULES["plugin/batch.js"] = function (module, exports, require) {
"use strict";
/** Пакетная запись файлов и отмена. */
const { Notice, TFile } = require("obsidian");
const { BatchReportModal } = require("../modals/batch-report-modal.js");
const { addTagsToMarkdownDocument } = require("../tags/add-tags.js");
const { moveTagsToText, moveTagsToYaml } = require("../tags/move.js");
const { listPosts, transformPostsOrNote } = require("../tags/posts.js");
const { replaceTagsInMarkdown } = require("../tags/refactor.js");
const { pluralRu } = require("../utils.js");
const { normalizeTag } = require("../tags/tag-name.js");

/** Методы подмешиваются в TagRefactorAuditorPlugin. */
class BatchMixin {
    /**
     * Transform for the audit queue: (file, content) -> new content. Changes are
     * filtered by their note selection; changes limited to chosen records of this
     * note are applied to those records only (grouped by identical selection).
     */
    buildQueueTransform(changes) {
        const caseSensitive = this.settings.caseSensitive;
        return (file, content) => {
            const applicable = this.changesForFile(changes, file);
            const groups = new Map();
            for (const change of applicable) {
                const selection = change.posts?.[file.path] ?? null;
                const key = selection ? JSON.stringify(selection) : "";
                if (!groups.has(key))
                    groups.set(key, { selection, changes: [] });
                groups.get(key).changes.push(change);
            }
            let text = content;
            // Whole-note changes first, so their YAML edits see the original record layout.
            for (const key of [...groups.keys()].sort()) {
                const group = groups.get(key);
                const apply = (value) => replaceTagsInMarkdown(value, group.changes, caseSensitive).text;
                text = transformPostsOrNote(text, group.selection, apply, apply);
            }
            return text;
        };
    }
    /** Transform for the "Заметки по датам" page; `payload.posts` maps paths to chosen records. */
    buildBulkTransform(payload) {
        const caseSensitive = this.settings.caseSensitive;
        const postsFor = (file) => payload.posts?.[file.path] ?? null;
        const checkPosts = (file, content) => {
            const selection = postsFor(file);
            if (selection && listPosts(content).count !== selection.count)
                throw new Error("записи в заметке изменились после выбора — выберите их заново");
            return selection;
        };
        switch (payload.kind) {
            case "add":
                return (file, content) => {
                    const cache = this.app.metadataCache.getFileCache(file);
                    const inlineSourceTags = (cache?.tags ?? []).map((tag) => normalizeTag(tag.tag)).filter(Boolean);
                    return transformPostsOrNote(content, postsFor(file),
                        (value) => addTagsToMarkdownDocument(value, payload.tags, caseSensitive, inlineSourceTags, payload.alwaysYaml === true).text,
                        // Inside a chosen record tags always go into its text.
                        (value) => addTagsToMarkdownDocument(value, payload.tags, caseSensitive, [], false).text);
                };
            case "to-yaml":
                return (file, content) => moveTagsToYaml(content, { tags: payload.tags, caseSensitive, posts: checkPosts(file, content)?.indices });
            case "to-text":
                return (file, content) => moveTagsToText(content, { tags: payload.tags, caseSensitive, posts: checkPosts(file, content)?.indices });
            default: {
                const apply = (value) => replaceTagsInMarkdown(value, payload.changes, caseSensitive).text;
                return (file, content) => transformPostsOrNote(content, postsFor(file), apply, apply);
            }
        }
    }
    /** Before/after of one note for the change preview, without writing anything. */
    async previewTransform(file, transform) {
        const before = await this.app.vault.cachedRead(file);
        return { before, after: transform(file, before) };
    }
    /**
     * Rewrite files with `transform`, collecting undo data. Files whose content
     * would not change are not written at all, so their modification time stays
     * intact and sync tools (Syncthing, Obsidian Sync) see no spurious edits.
     */
    async runBatch(files, transform, report) {
        const undoEntries = new Map();
        for (const file of files) {
            try {
                const current = await this.app.vault.read(file);
                if (transform(file, current) === current) {
                    report.unchangedFiles += 1;
                    continue;
                }
                let before = "";
                let after = "";
                await this.app.vault.process(file, (data) => {
                    before = data;
                    after = transform(file, data);
                    return after;
                });
                if (after !== before) {
                    report.updatedFiles += 1;
                    undoEntries.set(file.path, { before, after });
                }
                else {
                    report.unchangedFiles += 1;
                }
            }
            catch (error) {
                report.errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (undoEntries.size > 0) {
            this.lastUndo = undoEntries;
            this.lastUndoLabel = new Date().toLocaleString();
        }
        return undoEntries;
    }
    /**
     * Apply the queue. With `selectedPaths`, only those notes are written; the
     * queue is then kept so the remaining notes can be processed later.
     */
    async applyQueuedChanges(selectedPaths = null) {
        if (this.isApplying) {
            new Notice("Операция уже выполняется.");
            return null;
        }
        this.isApplying = true;
        try {
            // The confirmation dialog may have been open for a while: use the
            // current index so that notes tagged in the meantime are included.
            await this.scanTags({ force: true, render: false });
            const changes = this.getPendingChanges();
            const allAffected = this.affectedFiles(changes);
            // Notes tagged after the dialog opened were not offered for selection
            // and are therefore skipped as well.
            const affected = selectedPaths ? allAffected.filter((file) => selectedPaths.has(file.path)) : allAffected;
            const partial = affected.length < allAffected.length;
            const report = {
                requestedChanges: changes.length,
                updatedFiles: 0,
                unchangedFiles: 0,
                errors: [],
                mergedTargets: this.existingMergeTargets(changes),
            };
            await this.runBatch(affected, this.buildQueueTransform(changes), report);
            if (report.errors.length === 0 && !partial) {
                this.pendingChanges.clear();
                this.pendingAdditions.clear();
            }
            await this.scanTags({ force: true });
            if (partial) {
                const skipped = allAffected.length - affected.length;
                report.notes = [`Не выбрано ${skipped} ${pluralRu(skipped, "заметка", "заметки", "заметок")} — очередь сохранена, её можно применить к ним позже или очистить.`];
            }
            new BatchReportModal(this.app, this, report).open();
            return report;
        }
        finally {
            this.isApplying = false;
        }
    }
    async applyBulkTagOperation(files, payload) {
        if (this.isApplying) {
            new Notice("Операция уже выполняется.");
            return null;
        }
        this.isApplying = true;
        try {
            const report = {
                requestedChanges: payload.changes ? payload.changes.length : Math.max(1, payload.tags?.length ?? 0),
                updatedFiles: 0,
                unchangedFiles: 0,
                errors: [],
                mergedTargets: [],
            };
            const transform = this.buildBulkTransform(payload);
            await this.runBatch(files, transform, report);
            await this.scanTags({ force: true });
            new BatchReportModal(this.app, this, report).open();
            return report;
        }
        finally {
            this.isApplying = false;
        }
    }
    async undoLastBatch() {
        if (this.lastUndo.size === 0) {
            new Notice("Нет операции, которую можно отменить.");
            return;
        }
        if (this.isApplying) {
            new Notice("Дождитесь завершения текущей операции.");
            return;
        }
        let restored = 0;
        let skipped = 0;
        const errors = [];
        for (const [path, entry] of this.lastUndo) {
            const abstractFile = this.app.vault.getAbstractFileByPath(path);
            if (!(abstractFile instanceof TFile)) {
                skipped += 1;
                continue;
            }
            let didRestore = false;
            try {
                await this.app.vault.process(abstractFile, (currentContent) => {
                    if (currentContent !== entry.after)
                        return currentContent;
                    didRestore = true;
                    return entry.before;
                });
                if (didRestore)
                    restored += 1;
                else
                    skipped += 1;
            }
            catch (error) {
                errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.lastUndo.clear();
        await this.scanTags({ force: true });
        const summary = `Отменено: ${restored}. Пропущено (файл изменился после операции или удалён): ${skipped}. Ошибок: ${errors.length}.`;
        new Notice(summary, 8000);
        new BatchReportModal(this.app, this, {
            requestedChanges: 0,
            updatedFiles: restored,
            unchangedFiles: skipped,
            errors,
            mergedTargets: [],
        }, true).open();
    }
}

module.exports = { BatchMixin };
};

/* ===== src/plugin/core.js ===== */
EMBEDDED_MODULES["plugin/core.js"] = function (module, exports, require) {
"use strict";
/** Ядро плагина: жизненный цикл, настройки, сканирование индекса тегов. */
const { Notice } = require("obsidian");
const { DEFAULT_SETTINGS, NON_DATE_PROPERTIES, VIEW_TYPE } = require("../constants.js");
const { getFrontmatterProperty, parseCreationDate } = require("../dates.js");
const { buildFileTagMap, sameTagIndex, scanTagIndex } = require("../scanner.js");
const { TagAuditorSettingTab } = require("../settings-tab.js");
const { clampNumber } = require("../utils.js");
const { TagAuditorView } = require("../view/tag-auditor-view.js");

/**
 * Методы подмешиваются в класс плагина из корневого main.js.
 * initState() заменяет конструктор, start() / stop() — onload() / onunload().
 */
class PluginCoreMixin {
    initState() {
        this.settings = { ...DEFAULT_SETTINGS };
        this.tagIndex = new Map();
        this.pendingChanges = new Map();
        this.pendingAdditions = new Map();
        this.lastUndo = new Map();
        this.lastUndoLabel = "";
        this.fileTags = new Map();
        this.creationTimes = new Map();
        this.dateCandidates = null;
        this.isScanning = false;
        this.isApplying = false;
        this.indexDirty = true;
        this.lastScanTime = 0;
        this.debounceTimer = null;
        this.settingsTimer = null;
    }
    async start() {
        await this.loadSettings();
        this.registerView(VIEW_TYPE, (leaf) => new TagAuditorView(leaf, this));
        this.addRibbonIcon("tags", "Tag Refactor & Auditor", () => void this.activateView());
        this.addCommand({
            id: "open-tag-refactor-auditor",
            name: "Open Tag Refactor & Auditor",
            callback: () => void this.activateView(),
        });
        this.addCommand({
            id: "rescan-tags",
            name: "Rescan tags",
            callback: () => void this.scanTags({ force: true }).then(() => new Notice("Сканирование тегов завершено.")),
        });
        this.addCommand({
            id: "undo-last-refactor",
            name: "Undo last tag refactor",
            checkCallback: (checking) => {
                if (checking)
                    return this.lastUndo.size > 0;
                void this.undoLastBatch();
                return true;
            },
        });
        this.addSettingTab(new TagAuditorSettingTab(this.app, this));
        // The metadata cache is the source of truth for tags. Vault "modify" and
        // "create" fire before the cache is updated, so they would only trigger a
        // scan against stale data; "changed" follows every re-index instead and
        // "resolved" covers the initial indexing after startup.
        this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleScan()));
        this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("delete", () => this.scheduleScan()));
        this.registerEvent(this.app.vault.on("rename", () => this.scheduleScan()));
        this.app.workspace.onLayoutReady(() => {
            if (this.hasOpenView())
                void this.scanTags({ force: true });
        });
    }
    stop() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        if (this.settingsTimer !== null)
            window.clearTimeout(this.settingsTimer);
    }
    async loadSettings() {
        const loaded = (await this.loadData());
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...(loaded ?? {}),
            previewChars: clampNumber(loaded?.previewChars, 80, 1200, DEFAULT_SETTINGS.previewChars),
            caseSensitive: Boolean(loaded?.caseSensitive ?? DEFAULT_SETTINGS.caseSensitive),
            ignoredFolders: Array.isArray(loaded?.ignoredFolders)
                ? loaded.ignoredFolders.filter((path) => typeof path === "string")
                : [...DEFAULT_SETTINGS.ignoredFolders],
            createdDateProperty: typeof loaded?.createdDateProperty === "string"
                ? loaded.createdDateProperty.trim()
                : DEFAULT_SETTINGS.createdDateProperty,
            fileDateField: loaded?.fileDateField === "mtime" ? "mtime" : "ctime",
            minTagMentions: clampNumber(loaded?.minTagMentions, 0, 1000000, DEFAULT_SETTINGS.minTagMentions),
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
        // Settings fields save on every keystroke; rescan once typing pauses.
        if (this.settingsTimer !== null)
            window.clearTimeout(this.settingsTimer);
        this.settingsTimer = window.setTimeout(() => {
            this.settingsTimer = null;
            this.creationTimes.clear();
            this.dateCandidates = null;
            if (this.hasOpenView())
                void this.scanTags({ force: true });
            else
                this.indexDirty = true;
        }, 400);
    }
    async activateView() {
        const workspace = this.app.workspace;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE);
        const rootLeaves = new Set();
        workspace.iterateRootLeaves((rootLeaf) => rootLeaves.add(rootLeaf));

        // Reuse the view if it is already in the main workspace area. If an older
        // version left it in a sidebar, detach that instance and recreate it as a
        // normal center-area tab.
        let leaf = leaves.find((candidate) => rootLeaves.has(candidate));
        for (const existingLeaf of leaves) {
            if (existingLeaf !== leaf)
                existingLeaf.detach();
        }

        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        await workspace.revealLeaf(leaf);
    }
    hasOpenView() {
        return this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0;
    }
    /**
     * Rebuild the tag index. Views are re-rendered only when the set of tags or
     * the notes that carry them actually changed, so ordinary typing in a note
     * does not rebuild the whole screen; `force` always re-renders.
     */
    async scanTags(options = {}) {
        const { force = false, render = true } = options;
        if (this.isScanning)
            return false;
        this.isScanning = true;
        let changed = false;
        try {
            if (this.debounceTimer !== null) {
                window.clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            const next = scanTagIndex(this.app, this.settings);
            changed = force || !sameTagIndex(this.tagIndex, next);
            this.tagIndex = next;
            this.fileTags = buildFileTagMap(next);
            this.creationTimes.clear();
            this.dateCandidates = null;
            this.lastScanTime = Date.now();
            this.indexDirty = false;
        }
        finally {
            this.isScanning = false;
        }
        if (changed && render)
            this.refreshViews();
        return changed;
    }
    /** Make sure the index reflects the vault before it is shown or used for writes. */
    async ensureFreshIndex() {
        if (this.indexDirty || this.debounceTimer !== null || this.tagIndex.size === 0)
            await this.scanTags({ force: true, render: false });
    }
    scheduleScan() {
        if (this.debounceTimer !== null)
            window.clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        // Nobody looks at the index while the view is closed: just remember that
        // it is stale and rebuild it when the view opens.
        if (!this.hasOpenView()) {
            this.indexDirty = true;
            return;
        }
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            void this.scanTags();
        }, 500);
    }
    refreshViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            if (leaf.view instanceof TagAuditorView)
                leaf.view.requestRender();
        }
    }
    getTagsForFile(file) {
        return this.fileTags.get(file.path) ?? [];
    }
    /** Creation date used for sorting and filtering, cached until the next scan. */
    getNoteCreationTimestamp(file) {
        const cached = this.creationTimes.get(file.path);
        if (cached !== undefined)
            return cached;
        const property = (this.settings.createdDateProperty ?? "").trim();
        let value;
        if (!property) {
            value = (this.settings.fileDateField === "mtime" ? file.stat?.mtime : file.stat?.ctime) ?? 0;
        }
        else {
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            value = parseCreationDate(getFrontmatterProperty(frontmatter, property));
        }
        this.creationTimes.set(file.path, value);
        return value;
    }
    /** Human-readable name of the current date source. */
    describeDateSource() {
        const property = (this.settings.createdDateProperty ?? "").trim();
        if (property)
            return `свойство YAML «${property}»`;
        return this.settings.fileDateField === "mtime" ? "дата изменения файла" : "дата создания файла";
    }
    /**
     * Frontmatter properties that hold parseable dates, with the number of notes
     * for each. File copies and sync tools (Syncthing) reset file creation times,
     * so a YAML date is often the only reliable source. Cached until the next scan.
     */
    getDateFieldCandidates() {
        if (this.dateCandidates)
            return this.dateCandidates;
        const counts = new Map();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!frontmatter || typeof frontmatter !== "object")
                continue;
            for (const [key, value] of Object.entries(frontmatter)) {
                if (NON_DATE_PROPERTIES.has(key.toLowerCase()) || key === "position")
                    continue;
                if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date))
                    continue;
                if (parseCreationDate(value) > 0)
                    counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        this.dateCandidates = [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 12)
            .map(([key, count]) => ({ key, count }));
        return this.dateCandidates;
    }
    /** Switch the date source used for sorting and date filters. */
    async setDateSource(source) {
        if (source === "ctime" || source === "mtime") {
            this.settings.createdDateProperty = "";
            this.settings.fileDateField = source;
        }
        else {
            this.settings.createdDateProperty = source;
        }
        this.creationTimes.clear();
        await this.saveData(this.settings);
    }
}

module.exports = { PluginCoreMixin };
};

/* ===== src/plugin/queue.js ===== */
EMBEDDED_MODULES["plugin/queue.js"] = function (module, exports, require) {
"use strict";
/** Очередь изменений тегов. */
const { Notice } = require("obsidian");
const { pluralRu } = require("../utils.js");
const { cleanTagInput, isValidTag, normalizeTag, tagKey } = require("../tags/tag-name.js");

/** Методы подмешиваются в TagRefactorAuditorPlugin. */
class QueueMixin {
    getTagInfo(tag) {
        return this.tagIndex.get(tagKey(tag, this.settings.caseSensitive));
    }
    getPendingChanges() {
        return [...this.pendingChanges.values(), ...this.pendingAdditions.values()];
    }
    /** Notes a change applies to: all notes with its tag, or only `change.paths`. */
    filesForChange(change) {
        const files = this.getTagInfo(change.oldTag)?.files ?? [];
        if (!Array.isArray(change.paths))
            return files;
        const allowed = new Set(change.paths);
        return files.filter((file) => allowed.has(file.path));
    }
    affectedFiles(changes = this.getPendingChanges()) {
        const files = new Map();
        for (const change of changes) {
            for (const file of this.filesForChange(change))
                files.set(file.path, file);
        }
        return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
    }
    /** Changes that should be applied to one note (respecting per-change note selection). */
    changesForFile(changes, file) {
        return changes.filter((change) => !Array.isArray(change.paths) || change.paths.includes(file.path));
    }
    /**
     * Convert a note selection into the stored scope: undefined means "all notes
     * with the tag" (so notes tagged later are included), an array limits it.
     * Returns null when nothing is selected.
     */
    resolveScope(info, paths, postSelections = null) {
        const selected = paths ? info.files.filter((file) => paths.has(file.path)).map((file) => file.path) : info.files.map((file) => file.path);
        if (selected.length === 0) {
            new Notice("Отметьте хотя бы одну заметку, к которой применить изменение.");
            return null;
        }
        // Chosen records (`{ indices, count }`) of the selected notes only.
        let posts;
        if (postSelections) {
            const selectedSet = new Set(selected);
            for (const [path, selection] of postSelections) {
                if (selectedSet.has(path)) {
                    posts ??= {};
                    posts[path] = { indices: [...selection.indices], count: selection.count };
                }
            }
        }
        return { paths: selected.length === info.files.length ? undefined : selected, posts };
    }
    scopeLabel(scope, info) {
        const parts = [];
        if (scope.paths)
            parts.push(`${scope.paths.length} из ${info.files.length} ${pluralRu(info.files.length, "заметки", "заметок", "заметок")}`);
        const withPosts = scope.posts ? Object.keys(scope.posts).length : 0;
        if (withPosts)
            parts.push(`выбранные записи в ${withPosts} ${pluralRu(withPosts, "заметке", "заметках", "заметках")}`);
        return parts.length ? ` (${parts.join(", ")})` : "";
    }
    addOrUpdateChange(oldTagValue, newTagValue, paths = null, posts = null) {
        const oldTag = normalizeTag(oldTagValue);
        const newTag = normalizeTag(cleanTagInput(newTagValue));
        if (!oldTag || !newTag) {
            new Notice("Укажите старый и новый теги.");
            return false;
        }
        if (!isValidTag(newTag)) {
            new Notice("Имя тега может содержать буквы, цифры, `_`, `-` и `/` для вложенности. Пробелы не поддерживаются.");
            return false;
        }
        const oldKey = tagKey(oldTag, this.settings.caseSensitive);
        if (oldKey === tagKey(newTag, this.settings.caseSensitive)) {
            new Notice("Старое и новое имена тегов совпадают.");
            return false;
        }
        if (!this.tagIndex.has(oldKey)) {
            new Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const info = this.tagIndex.get(oldKey);
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag, action: "rename", paths: scope.paths, posts: scope.posts });
        this.refreshViews();
        return true;
    }
    addMultipleTagsChange(sourceTagValue, rawTagsValue, paths = null, posts = null) {
        const sourceTag = normalizeTag(sourceTagValue);
        const rawTags = typeof rawTagsValue === "string" ? rawTagsValue : "";
        const requestedTags = rawTags.split(/[\s,;]+/).map((value) => cleanTagInput(value)).filter(Boolean);
        if (!sourceTag || requestedTags.length === 0) {
            new Notice("Укажите один или несколько новых тегов.");
            return false;
        }
        const oldKey = tagKey(sourceTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new Notice(`Тег #${sourceTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        const previous = this.pendingAdditions.get(oldKey);
        // A different note selection starts a new addition instead of merging.
        const sameScope = previous && JSON.stringify([previous.paths ?? null, previous.posts ?? null]) === JSON.stringify([scope.paths ?? null, scope.posts ?? null]);
        const existingPending = sameScope ? previous.addTags : [];
        const allTags = [...existingPending];
        const seen = new Set(allTags.map((tag) => tagKey(tag, this.settings.caseSensitive)));
        for (const tagValue of requestedTags) {
            const tag = normalizeTag(tagValue);
            if (!tag || !isValidTag(tag)) {
                new Notice(`Некорректное имя тега: ${tagValue}. Используйте буквы, цифры, \`_\`, \`-\` и \`/\` для вложенности.`);
                return false;
            }
            const key = tagKey(tag, this.settings.caseSensitive);
            if (key === oldKey) {
                new Notice(`Тег #${tag} уже выбран как исходный; его не нужно добавлять повторно.`);
                continue;
            }
            if (seen.has(key))
                continue;
            seen.add(key);
            allTags.push(tag);
        }
        if (allTags.length === existingPending.length) {
            new Notice("Все указанные теги уже есть в очереди или совпадают с исходным тегом.");
            return false;
        }
        this.pendingAdditions.set(oldKey, {
            oldTag: info.tag,
            newTag: null,
            action: "add",
            addTags: allTags,
            paths: scope.paths,
            posts: scope.posts,
        });
        new Notice(`Добавление тегов к заметкам с #${info.tag}${this.scopeLabel(scope, info)} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    addDeleteTagChange(oldTagValue, paths = null, posts = null) {
        const oldTag = normalizeTag(oldTagValue);
        if (!oldTag) {
            new Notice("Не удалось определить тег для удаления.");
            return false;
        }
        const oldKey = tagKey(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: null, action: "delete", paths: scope.paths, posts: scope.posts });
        new Notice(`Удаление #${info.tag}${this.scopeLabel(scope, info)} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    addUnmarkTagChange(oldTagValue, paths = null, posts = null) {
        const oldTag = normalizeTag(oldTagValue);
        if (!oldTag) {
            new Notice("Не удалось определить тег для снятия маркировки.");
            return false;
        }
        const oldKey = tagKey(oldTag, this.settings.caseSensitive);
        const info = this.tagIndex.get(oldKey);
        if (!info) {
            new Notice(`Тег #${oldTag} больше не найден. Обновите список тегов.`);
            return false;
        }
        const scope = this.resolveScope(info, paths, posts);
        if (!scope)
            return false;
        this.pendingChanges.set(oldKey, { oldTag: info.tag, newTag: info.tag, action: "unmark", paths: scope.paths, posts: scope.posts });
        new Notice(`Снятие маркировки #${info.tag}${this.scopeLabel(scope, info)} добавлено в очередь.`);
        this.refreshViews();
        return true;
    }
    removeChange(oldTag, action) {
        const key = tagKey(oldTag, this.settings.caseSensitive);
        if (!action || action === "add")
            this.pendingAdditions.delete(key);
        if (!action || action !== "add") {
            const existing = this.pendingChanges.get(key);
            if (!action || !existing || existing.action === action)
                this.pendingChanges.delete(key);
        }
        this.refreshViews();
    }
    clearChanges() {
        this.pendingChanges.clear();
        this.pendingAdditions.clear();
        this.refreshViews();
    }
    existingMergeTargets(changes = this.getPendingChanges()) {
        const targetKeys = new Set();
        const results = [];
        for (const change of changes) {
            if (change.action === "delete" || change.newTag === null)
                continue;
            const key = tagKey(change.newTag, this.settings.caseSensitive);
            if (key === tagKey(change.oldTag, this.settings.caseSensitive))
                continue;
            const existing = this.tagIndex.get(key);
            if (existing && !results.includes(change.newTag))
                results.push(change.newTag);
            if (targetKeys.has(key) && !results.includes(change.newTag))
                results.push(change.newTag);
            targetKeys.add(key);
        }
        return results;
    }
}

module.exports = { QueueMixin };
};

/* ===== src/scanner.js ===== */
EMBEDDED_MODULES["scanner.js"] = function (module, exports, require) {
"use strict";
/** Построение индекса тегов из кэша метаданных Obsidian. */
const { collectFrontmatterTags } = require("./tags/frontmatter.js");
const { normalizeTag, tagKey } = require("./tags/tag-name.js");

// Same ordering as String#localeCompare, but without re-creating locale data per call.
const PATH_COLLATOR = new Intl.Collator();
function normalizeFolderPath(path) {
    return path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
}
function isIgnoredPath(path, ignoredFolders) {
    const normalizedPath = normalizeFolderPath(path);
    return ignoredFolders.some((folder) => {
        const normalizedFolder = normalizeFolderPath(folder);
        return normalizedFolder.length > 0 &&
            (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
    });
}
/** Build an `isIgnored(path)` predicate with the folder list normalized once. */
function makeIgnoredPathMatcher(ignoredFolders) {
    const folders = (ignoredFolders ?? []).map(normalizeFolderPath).filter(Boolean);
    if (folders.length === 0)
        return () => false;
    const prefixes = folders.map((folder) => `${folder}/`);
    return (path) => {
        const normalizedPath = normalizeFolderPath(path);
        for (let i = 0; i < folders.length; i += 1) {
            if (normalizedPath === folders[i] || normalizedPath.startsWith(prefixes[i]))
                return true;
        }
        return false;
    };
}
function makeTagCollator(caseSensitive) {
    return new Intl.Collator(undefined, { sensitivity: caseSensitive ? "variant" : "base", numeric: true });
}
function scanTagIndex(app, settings) {
    const result = new Map();
    const isIgnored = makeIgnoredPathMatcher(settings.ignoredFolders);
    const files = app.vault.getMarkdownFiles()
        .filter((file) => !isIgnored(file.path))
        .sort((a, b) => PATH_COLLATOR.compare(a.path, b.path));
    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache)
            continue;
        // Keep one canonical tag per identity in each note. In case-insensitive
        // mode #Project and #project in one file must still count as one occurrence.
        const tagsInFile = new Map();
        for (const cachedTag of cache.tags ?? []) {
            const normalized = normalizeTag(cachedTag.tag);
            if (normalized) {
                const key = tagKey(normalized, settings.caseSensitive);
                if (!tagsInFile.has(key))
                    tagsInFile.set(key, normalized);
            }
        }
        for (const frontmatterTag of collectFrontmatterTags(cache.frontmatter)) {
            const key = tagKey(frontmatterTag, settings.caseSensitive);
            if (!tagsInFile.has(key))
                tagsInFile.set(key, frontmatterTag);
        }
        for (const [key, tag] of tagsInFile) {
            let info = result.get(key);
            if (!info) {
                info = { tag, key, files: [] };
                result.set(key, info);
            }
            info.files.push(file);
        }
    }
    const collator = makeTagCollator(settings.caseSensitive);
    return new Map([...result.entries()].sort(([, a], [, b]) => collator.compare(a.tag, b.tag)));
}
/** path -> tags of that note, in catalog order. */
function buildFileTagMap(index) {
    const map = new Map();
    for (const info of index.values()) {
        for (const file of info.files) {
            let tags = map.get(file.path);
            if (!tags) {
                tags = [];
                map.set(file.path, tags);
            }
            tags.push(info.tag);
        }
    }
    return map;
}
/** True when two indexes contain the same tags in the same notes. */
function sameTagIndex(a, b) {
    if (a.size !== b.size)
        return false;
    for (const [key, info] of a) {
        const other = b.get(key);
        if (!other || other.tag !== info.tag || other.files.length !== info.files.length)
            return false;
        for (let i = 0; i < info.files.length; i += 1) {
            if (info.files[i] !== other.files[i] && info.files[i].path !== other.files[i].path)
                return false;
        }
    }
    return true;
}
function tagCountForFiles(index) {
    let total = 0;
    for (const info of index.values())
        total += info.files.length;
    return total;
}

module.exports = { makeIgnoredPathMatcher, scanTagIndex, buildFileTagMap, sameTagIndex };
};

/* ===== src/settings-tab.js ===== */
EMBEDDED_MODULES["settings-tab.js"] = function (module, exports, require) {
"use strict";
/** Вкладка настроек плагина. */
const { Notice, PluginSettingTab, Setting } = require("obsidian");
const { clampNumber } = require("./utils.js");

class TagAuditorSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Tag Refactor & Auditor" });
        containerEl.createEl("p", { text: "Настройки сканирования и предпросмотра тегов." });
        new Setting(containerEl)
            .setName("Длина предпросмотра")
            .setDesc("Количество символов в выдержке заметки.")
            .addText((text) => text
            .setPlaceholder("400")
            .setValue(String(this.plugin.settings.previewChars))
            .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed))
                return;
            this.plugin.settings.previewChars = clampNumber(parsed, 80, 1200, 400);
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("YAML-атрибут даты создания заметки")
            .setDesc("Имя поля YAML, например created или Дата. Поддерживаются ISO, числовые даты и названия месяцев на разных языках (например, 12 октября 2012). Если поле указано, заметки без корректной даты идут в конец; если поле пустое, используется дата файла (см. ниже).")
            .addText((text) => text
            .setPlaceholder("created")
            .setValue(this.plugin.settings.createdDateProperty)
            .onChange(async (value) => {
            this.plugin.settings.createdDateProperty = value.trim();
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("Дата файла, если YAML-атрибут не задан")
            .setDesc("Syncthing и копирование файлов часто сбрасывают дату создания файла на дату синхронизации; в этом случае лучше указать YAML-атрибут выше.")
            .addDropdown((dropdown) => dropdown
            .addOption("ctime", "Дата создания файла")
            .addOption("mtime", "Дата изменения файла")
            .setValue(this.plugin.settings.fileDateField ?? "ctime")
            .onChange(async (value) => {
            this.plugin.settings.fileDateField = value === "mtime" ? "mtime" : "ctime";
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("Учитывать регистр")
            .setDesc("При включении #Project и #project считаются разными тегами.")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.caseSensitive)
            .onChange(async (value) => {
            this.plugin.settings.caseSensitive = value;
            // Queued operations are keyed by the old case mode; keeping them
            // could apply a change to the wrong set of tags.
            if (this.plugin.getPendingChanges().length > 0) {
                this.plugin.clearChanges();
                new Notice("Очередь изменений очищена: режим учёта регистра изменился.");
            }
            await this.plugin.saveSettings();
        }));
        new Setting(containerEl)
            .setName("Игнорируемые папки")
            .setDesc("Пути относительно корня хранилища, по одному на строку. В эти папки плагин не будет заходить при сканировании.")
            .addTextArea((text) => {
            text
                .setPlaceholder("Templates\nArchive")
                .setValue(this.plugin.settings.ignoredFolders.join("\n"));
            text.inputEl.rows = 5;
            text.inputEl.addClass("tra-settings-textarea");
            text.onChange(async (value) => {
                this.plugin.settings.ignoredFolders = value
                    .split(/\r?\n/)
                    .map((path) => path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
                    .filter(Boolean);
                await this.plugin.saveSettings();
            });
        });
        containerEl.createEl("p", {
            cls: "tra-settings-note",
            text: "Пакетное применение сохраняет формат YAML и кодовые блоки. Последнюю операцию можно отменить, если файлы после неё не менялись.",
        });
    }
}

module.exports = { TagAuditorSettingTab };
};

/* ===== src/tags/add-tags.js ===== */
EMBEDDED_MODULES["tags/add-tags.js"] = function (module, exports, require) {
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
};

/* ===== src/tags/changes.js ===== */
EMBEDDED_MODULES["tags/changes.js"] = function (module, exports, require) {
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
};

/* ===== src/tags/extract.js ===== */
EMBEDDED_MODULES["tags/extract.js"] = function (module, exports, require) {
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
};

/* ===== src/tags/frontmatter.js ===== */
EMBEDDED_MODULES["tags/frontmatter.js"] = function (module, exports, require) {
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
};

/* ===== src/tags/markdown.js ===== */
EMBEDDED_MODULES["tags/markdown.js"] = function (module, exports, require) {
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
};

/* ===== src/tags/move.js ===== */
EMBEDDED_MODULES["tags/move.js"] = function (module, exports, require) {
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
};

/* ===== src/tags/posts.js ===== */
EMBEDDED_MODULES["tags/posts.js"] = function (module, exports, require) {
"use strict";
/**
 * Записи внутри заметки: фрагменты текста между разделителями `---`
 * (так устроены экспорты ЖЖ и Telegram). Фронтматтер записью не считается.
 */
const { matchFrontmatter } = require("./frontmatter.js");
const { splitMarkdownPostSegments } = require("./markdown.js");

function splitNote(content) {
    const match = matchFrontmatter(content);
    const head = match ? match.whole : "";
    const segments = splitMarkdownPostSegments(content.slice(head.length));
    return { head, segments };
}

/**
 * Records of a note, numbered from 0 in document order (empty ones included,
 * so the numbering is stable). `count` is used to detect later edits.
 */
function listPosts(content) {
    const { segments } = splitNote(content);
    const posts = [];
    for (const segment of segments) {
        if (segment.type === "post")
            posts.push({ index: posts.length, text: segment.text, isEmpty: segment.text.trim() === "" });
    }
    return { posts, count: posts.length };
}

/** Number of non-empty records; a note with fewer than two has nothing to choose. */
function countMeaningfulPosts(content) {
    return listPosts(content).posts.filter((post) => !post.isEmpty).length;
}

/**
 * Apply `transform(text, index)` only to the records whose indices are in
 * `indices`; separators, other records and the frontmatter stay untouched.
 */
function applyToPosts(content, indices, transform) {
    const { head, segments } = splitNote(content);
    let index = -1;
    for (const segment of segments) {
        if (segment.type !== "post")
            continue;
        index += 1;
        if (indices.has(index))
            segment.text = transform(segment.text, index);
    }
    return `${head}${segments.map((segment) => segment.text).join("")}`;
}

/**
 * Wrap a whole-note transform so it respects a record selection
 * `{ indices: number[], count: number }`. Throws when the note has a different
 * number of records than when they were chosen.
 */
function transformPostsOrNote(content, postSelection, wholeNote, perPost) {
    if (!postSelection)
        return wholeNote(content);
    const { count } = listPosts(content);
    if (count !== postSelection.count)
        throw new Error("записи в заметке изменились после выбора — выберите их заново");
    return applyToPosts(content, new Set(postSelection.indices), perPost);
}

module.exports = { listPosts, countMeaningfulPosts, applyToPosts, transformPostsOrNote };
};

/* ===== src/tags/refactor.js ===== */
EMBEDDED_MODULES["tags/refactor.js"] = function (module, exports, require) {
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
};

/* ===== src/tags/tag-name.js ===== */
EMBEDDED_MODULES["tags/tag-name.js"] = function (module, exports, require) {
"use strict";
/** Нормализация, сравнение и проверка имён тегов. */

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
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { normalizeTag, tagKey, isValidTag, cleanTagInput, escapeRegExp };
};

/* ===== src/tags/yaml.js ===== */
EMBEDDED_MODULES["tags/yaml.js"] = function (module, exports, require) {
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
};

/* ===== src/utils.js ===== */
EMBEDDED_MODULES["utils.js"] = function (module, exports, require) {
"use strict";
/** Небольшие общие помощники: склонение, время, числа, миксины. */

function findTextIndex(text, needle, caseSensitive) {
    return caseSensitive
        ? text.indexOf(needle)
        : text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
}
function pluralRu(count, one, few, many) {
    const abs = Math.abs(count) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20)
        return many;
    if (last > 1 && last < 5)
        return few;
    if (last === 1)
        return one;
    return many;
}
function relativeTime(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1)
        return "только что";
    if (minutes < 60)
        return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} д назад`;
}
function clampNumber(value, min, max, fallback) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}
/** Copy methods of mixin classes onto `target.prototype`, so one class can be split across files. */
function applyMixins(target, ...mixins) {
    for (const mixin of mixins) {
        for (const name of Object.getOwnPropertyNames(mixin.prototype)) {
            if (name === "constructor")
                continue;
            Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
        }
    }
}

/** Wrap visible mentions of `tag` in rendered Markdown with <mark class="tra-highlight">. */
function highlightTagInElement(container, tag, caseSensitive) {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = caseSensitive ? "gu" : "giu";
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_/#-])#?${escapedTag}(?![\\p{L}\\p{N}_/-])`, flags);
    const walker = document.createTreeWalker(container, 4 /* SHOW_TEXT */);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest("code, pre, script, style, mark.tra-highlight"))
            continue;
        if (pattern.test(node.nodeValue ?? "")) {
            pattern.lastIndex = 0;
            textNodes.push(node);
        }
        pattern.lastIndex = 0;
    }
    for (const textNode of textNodes) {
        const text = textNode.nodeValue ?? "";
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (match.index > cursor)
                fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
            const mark = document.createElement("mark");
            mark.className = "tra-highlight";
            mark.textContent = match[0];
            fragment.appendChild(mark);
            cursor = match.index + match[0].length;
            if (match[0].length === 0)
                pattern.lastIndex += 1;
        }
        if (cursor === 0)
            continue;
        if (cursor < text.length)
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
        textNode.parentNode?.replaceChild(fragment, textNode);
    }
}

/** Show "Записи: k из n" on a card when only some records of the note are chosen. */
function updatePostBadge(card, selection) {
    const badge = card.querySelector(".tra-post-badge");
    if (!badge)
        return;
    if (selection) {
        badge.textContent = `Записи: ${selection.indices.length} из ${selection.meaningful ?? selection.count}`;
        badge.style.display = "";
    }
    else {
        badge.textContent = "";
        badge.style.display = "none";
    }
}

module.exports = { updatePostBadge, highlightTagInElement, findTextIndex, pluralRu, relativeTime, clampNumber, applyMixins };
};

/* ===== src/view/audit-page.js ===== */
EMBEDDED_MODULES["view/audit-page.js"] = function (module, exports, require) {
"use strict";
/** Страница «Аудит тегов»: каталог тегов, карточка выбранного тега, предпросмотры и очередь. */
const { MarkdownRenderer, setIcon } = require("obsidian");
const { BULK_PAGE_SIZE, CATALOG_PAGE_SIZE, PREVIEW_PAGE_SIZE } = require("../constants.js");
const { ApplyConfirmModal } = require("../modals/apply-confirm-modal.js");
const { NotePreviewModal } = require("../modals/note-preview-modal.js");
const { stripFrontmatter } = require("../tags/frontmatter.js");
const { findInlineTagIndex } = require("../tags/markdown.js");
const { cleanTagInput, isValidTag, tagKey } = require("../tags/tag-name.js");
const { findTextIndex, highlightTagInElement, pluralRu, updatePostBadge } = require("../utils.js");

/** Методы подмешиваются в TagAuditorView. */
class AuditPageMixin {
    renderAuditPage(shell, previousTagListScrollTop) {
        const workspace = shell.createDiv({ cls: "tra-bento-grid" });
        const tagBrowser = workspace.createDiv({ cls: "tra-tag-browser-card" });
        const searchWrap = tagBrowser.createDiv({ cls: "tra-search-wrap" });
        const searchIcon = searchWrap.createDiv({ cls: "tra-search-icon" });
        setIcon(searchIcon, "search");
        const search = searchWrap.createEl("input", {
            cls: "tra-search",
            attr: { type: "text", placeholder: "Найти тег…", "aria-label": "Поиск тегов", "data-tra-field": "search" },
        });
        search.value = this.query;
        const clearButton = searchWrap.createEl("button", {
            cls: "tra-search-clear",
            attr: { type: "button", "aria-label": "Очистить поиск", title: "Очистить поле поиска" },
        });
        setIcon(clearButton, "x");

        const listHeader = tagBrowser.createDiv({ cls: "tra-section-heading" });
        listHeader.createEl("span", { text: "Теги" });
        const tagTotal = listHeader.createSpan({ cls: "tra-tag-total", text: String(this.plugin.tagIndex.size) });

        const sortControl = tagBrowser.createDiv({ cls: "tra-sort-control" });
        const sortLabel = sortControl.createEl("label", { cls: "tra-sort-label", text: "Сортировка тегов" });
        const sortSelect = sortControl.createEl("select", {
            cls: "tra-sort-select",
            attr: {
                "aria-label": "Сортировка тегов",
                title: "Сортировка по самой поздней дате создания заметки с тегом. Источник даты задаётся в настройках.",
            },
        });
        sortLabel.setAttr("for", sortSelect.id = `tra-sort-${Math.random().toString(36).slice(2, 9)}`);
        const sortOptions = [
            ["name", "По названию"],
            ["recent", "По дате создания заметки"],
            ["count", "По количеству заметок"],
        ];
        for (const [value, label] of sortOptions)
            sortSelect.createEl("option", { text: label, attr: { value } });
        sortSelect.value = this.sortMode;

        const mentionFilter = tagBrowser.createDiv({ cls: "tra-mention-filter" });
        const mentionLabel = mentionFilter.createEl("label", {
            cls: "tra-sort-label",
            text: "Порог упоминаний (число заметок)",
        });
        const mentionInput = mentionFilter.createEl("input", {
            cls: "tra-threshold-input",
            attr: {
                type: "number",
                min: "0",
                step: "1",
                placeholder: "0",
                title: "Пусто или 0 — показывать все теги",
                "aria-label": "Минимальное число заметок с тегом",
                "data-tra-field": "min-mentions",
            },
        });
        mentionInput.value = String(this.plugin.settings.minTagMentions ?? 0);
        mentionLabel.setAttr("for", mentionInput.id = `tra-min-mentions-${Math.random().toString(36).slice(2, 9)}`);

        const alphabetNav = tagBrowser.createDiv({
            cls: "tra-alpha-nav",
            attr: { "aria-label": "Переход к тегам по первой букве" },
        });
        const list = tagBrowser.createDiv({ cls: "tra-tag-list" });
        const renderList = () => {
            tagTotal.setText(String(this.renderTagRows(list, search.value, alphabetNav)));
        };
        const updateSearchClearButton = () => {
            clearButton.style.display = search.value.length > 0 ? "flex" : "none";
        };
        list.addEventListener("scroll", () => {
            this.tagListScrollTop = list.scrollTop;
        }, { passive: true });
        // Re-filter once typing pauses instead of rebuilding the catalog on every key.
        let searchTimer = null;
        search.addEventListener("input", () => {
            this.query = search.value;
            updateSearchClearButton();
            if (searchTimer !== null)
                window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => {
                searchTimer = null;
                if (list.isConnected)
                    renderList();
            }, 120);
        });
        clearButton.addEventListener("click", () => {
            search.value = "";
            this.query = "";
            updateSearchClearButton();
            renderList();
            search.focus();
        });
        sortSelect.addEventListener("change", () => {
            this.sortMode = sortSelect.value;
            renderList();
        });
        mentionInput.addEventListener("input", () => {
            const raw = mentionInput.value.trim();
            const parsed = raw === "" ? 0 : Number.parseInt(raw, 10);
            this.plugin.settings.minTagMentions = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            renderList();
            void this.plugin.saveData(this.plugin.settings);
        });
        updateSearchClearButton();
        renderList();
        // Restore after layout has been recalculated. The animation-frame restore
        // avoids browsers resetting scrollTop while the new tag rows are measured.
        // Rows are rendered in portions, so render enough of them first.
        this.ensureCatalogHeight(previousTagListScrollTop);
        list.scrollTop = previousTagListScrollTop;
        window.requestAnimationFrame(() => {
            if (list.isConnected) {
                this.ensureCatalogHeight(previousTagListScrollTop);
                list.scrollTop = previousTagListScrollTop;
            }
        });

        // Bento layout: tag browser occupies the left column; preview and queue
        // are separate cards in the right column.
        // The right column is one flex stack, so a tall tag catalog on the left no
        // longer stretches the grid rows and pushes the queue card down.
        const side = workspace.createDiv({ cls: "tra-side-column" });
        this.renderSelectedTag(side);
        this.renderPendingChanges(side);
    }
    renderTagRows(parent, query, alphabetNav) {
        parent.empty();
        const normalizedQuery = query.trim().replace(/^#/, "").toLocaleLowerCase();
        const configuredThreshold = Number(this.plugin.settings.minTagMentions ?? 0);
        const threshold = Number.isFinite(configuredThreshold) ? Math.max(0, Math.floor(configuredThreshold)) : 0;
        const entries = [...this.plugin.tagIndex.values()].filter((info) => info.files.length >= threshold && info.tag.toLocaleLowerCase().includes(normalizedQuery));
        // The index is already sorted by name; keep that order as a stable tie-breaker.
        const position = new Map();
        let indexPosition = 0;
        for (const key of this.plugin.tagIndex.keys())
            position.set(key, indexPosition++);
        const compareByName = (a, b) => (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0);
        if (this.sortMode === "count") {
            entries.sort((a, b) => b.files.length - a.files.length || compareByName(a, b));
        }
        else if (this.sortMode === "recent") {
            // Sort each tag by the newest creation date among notes containing it.
            // Date source: configured YAML property, or file ctime when the setting is empty.
            const latestTimes = new Map(entries.map((info) => [
                info.key,
                info.files.reduce((latest, file) => Math.max(latest, this.getNoteCreationTimestamp(file)), 0),
            ]));
            entries.sort((a, b) => (latestTimes.get(b.key) ?? 0) - (latestTimes.get(a.key) ?? 0) || compareByName(a, b));
        }
        // Build case-insensitive alphabet shortcuts from the currently visible tags.
        // Only letters present in the filtered result set are shown.
        alphabetNav.empty();
        const initials = new Map();
        for (const info of entries) {
            const first = Array.from(info.tag.trim())[0];
            if (!first || !/^\p{L}$/u.test(first))
                continue;
            const key = first.toLocaleLowerCase();
            if (!initials.has(key))
                initials.set(key, first.toLocaleUpperCase());
        }
        const orderedInitials = [...initials.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
        for (const [key, label] of orderedInitials) {
            const shortcut = alphabetNav.createEl("button", {
                cls: "tra-alpha-button",
                text: label,
                attr: {
                    type: "button",
                    title: `Перейти к тегам на букву ${label}`,
                    "aria-label": `Перейти к тегам на букву ${label}`,
                },
            });
            shortcut.addEventListener("click", () => {
                const index = entries.findIndex((info) => Array.from(info.tag.trim())[0]?.toLocaleLowerCase() === key);
                if (index < 0)
                    return;
                this.ensureCatalogRows(index + 1);
                const target = parent.querySelector(`.tra-tag-row[data-index="${index}"]`);
                if (!target)
                    return;
                const listRect = parent.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                const targetTop = parent.scrollTop + targetRect.top - listRect.top;
                parent.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
            });
        }
        alphabetNav.style.display = orderedInitials.length > 0 ? "flex" : "none";

        if (entries.length === 0) {
            const empty = parent.createDiv({ cls: "tra-empty" });
            const icon = empty.createDiv({ cls: "tra-empty-icon" });
            setIcon(icon, normalizedQuery ? "search-x" : "tags");
            empty.createEl("p", { text: normalizedQuery || threshold > 0 ? "Ничего не найдено" : "Теги не найдены" });
            empty.createEl("span", { text: normalizedQuery || threshold > 0 ? "Измените поиск или уменьшите порог упоминаний." : "После сканирования здесь появятся теги из заметок." });
            return 0;
        }
        // Rows are added in portions as the list is scrolled: a catalog of
        // thousands of tags opens and filters instantly, also on phones.
        this.catalog?.observer?.disconnect();
        this.catalog = { parent, entries, rendered: 0, sentinel: null, observer: null };
        if (!parent.dataset.traBound) {
            // One delegated handler for all rows instead of one per row.
            parent.dataset.traBound = "1";
            parent.addEventListener("click", (event) => {
                const row = event.target instanceof Element ? event.target.closest(".tra-tag-row") : null;
                const info = row ? this.catalog?.entries[Number(row.getAttribute("data-index"))] : null;
                if (!info)
                    return;
                this.selectedTag = info.tag;
                this.showAllPreviews = false;
                this.render();
            });
        }
        this.ensureCatalogRows(CATALOG_PAGE_SIZE);
        return entries.length;
    }
    /** Render catalog rows until at least `count` are in the DOM. */
    ensureCatalogRows(count) {
        const catalog = this.catalog;
        if (!catalog || !catalog.parent.isConnected && catalog.rendered > 0)
            return;
        const { parent, entries } = catalog;
        const target = Math.min(entries.length, count);
        if (catalog.rendered >= target)
            return;
        catalog.sentinel?.remove();
        const caseSensitive = this.plugin.settings.caseSensitive;
        const selectedKey = this.selectedTag !== null ? tagKey(this.selectedTag, caseSensitive) : null;
        const fragment = document.createDocumentFragment();
        for (let index = catalog.rendered; index < target; index += 1) {
            const info = entries[index];
            const isPending = this.plugin.pendingChanges.has(info.key) || this.plugin.pendingAdditions.has(info.key);
            const row = document.createElement("button");
            row.className = `tra-tag-row${info.key === selectedKey ? " is-selected" : ""}${isPending ? " is-pending" : ""}`;
            row.type = "button";
            row.setAttribute("data-index", String(index));
            row.title = `#${info.tag} — ${info.files.length} ${pluralRu(info.files.length, "заметка", "заметки", "заметок")}`;
            const hash = document.createElement("span");
            hash.className = "tra-tag-hash";
            hash.textContent = "#";
            hash.setAttribute("aria-hidden", "true");
            const name = document.createElement("span");
            name.className = "tra-tag-name";
            name.textContent = info.tag;
            row.append(hash, name);
            if (isPending) {
                const pendingMark = document.createElement("span");
                pendingMark.className = "tra-pending-dot";
                pendingMark.setAttribute("aria-label", "На изменение");
                row.append(pendingMark);
            }
            const count = document.createElement("span");
            count.className = "tra-tag-count";
            count.textContent = String(info.files.length);
            row.append(count);
            fragment.append(row);
        }
        parent.append(fragment);
        catalog.rendered = target;
        if (catalog.rendered < entries.length) {
            const sentinel = parent.createDiv({ cls: "tra-tag-sentinel", text: `Ещё ${entries.length - catalog.rendered}…` });
            catalog.sentinel = sentinel;
            if (typeof IntersectionObserver !== "undefined") {
                catalog.observer?.disconnect();
                catalog.observer = new IntersectionObserver((items) => {
                    if (items.some((item) => item.isIntersecting))
                        this.ensureCatalogRows(catalog.rendered + CATALOG_PAGE_SIZE);
                }, { root: parent, rootMargin: "400px 0px" });
                catalog.observer.observe(sentinel);
            }
            else {
                sentinel.addEventListener("click", () => this.ensureCatalogRows(catalog.rendered + CATALOG_PAGE_SIZE));
            }
        }
        else {
            catalog.observer?.disconnect();
            catalog.sentinel = null;
        }
    }
    /** Render enough rows for the list to be scrolled to `scrollTop`. */
    ensureCatalogHeight(scrollTop) {
        const catalog = this.catalog;
        if (!catalog)
            return;
        let guard = 0;
        while (catalog.rendered < catalog.entries.length
            && catalog.parent.scrollHeight < scrollTop + catalog.parent.clientHeight + 200
            && guard < 50) {
            this.ensureCatalogRows(catalog.rendered + CATALOG_PAGE_SIZE);
            guard += 1;
        }
    }
    renderSelectedTag(root) {
        if (this.selectedTag && !this.plugin.getTagInfo(this.selectedTag))
            this.selectedTag = null;
        if (!this.selectedTag) {
            const tip = root.createDiv({ cls: "tra-select-prompt" });
            const icon = tip.createDiv({ cls: "tra-select-icon" });
            setIcon(icon, "mouse-pointer-click");
            tip.createEl("strong", { text: "Выберите тег" });
            tip.createEl("p", { text: "Посмотрите, где он используется, и добавьте переименование в очередь." });
            return;
        }
        const info = this.plugin.getTagInfo(this.selectedTag);
        // Drafts survive re-renders (index updates while typing) but not a tag switch.
        if (this.renameDraft.tag !== info.key)
            this.renameDraft = { tag: info.key, value: "", addTags: "" };
        const selectedNotes = this.getNoteSelection(info);
        const card = root.createDiv({ cls: "tra-selected-card" });
        const selectedHeader = card.createDiv({ cls: "tra-selected-header" });
        const selectedTitle = selectedHeader.createDiv({ cls: "tra-selected-title" });
        selectedTitle.createEl("span", { cls: "tra-tag-hash", text: "#" });
        selectedTitle.createEl("h3", { text: info.tag });
        selectedHeader.createEl("span", { cls: "tra-count-pill", text: `${info.files.length} ${pluralRu(info.files.length, "заметка", "заметки", "заметок")}` });
        const form = card.createDiv({ cls: "tra-rename-form" });
        const label = form.createEl("label", { text: "Новое имя тега", cls: "tra-field-label" });
        const fieldRow = form.createDiv({ cls: "tra-field-row" });
        const hashPrefix = fieldRow.createSpan({ cls: "tra-input-prefix", text: "#" });
        hashPrefix.setAttr("aria-hidden", "true");
        const input = fieldRow.createEl("input", {
            cls: "tra-rename-input",
            attr: { type: "text", placeholder: "новый-тег", autocomplete: "off", spellcheck: "false", "data-tra-field": "rename" },
        });
        input.value = this.renameDraft.value;
        label.setAttr("for", input.id = `tra-rename-${Math.random().toString(36).slice(2, 9)}`);
        const addButton = fieldRow.createEl("button", { cls: "tra-primary-button tra-add-button", text: "В очередь" });
        addButton.type = "button";
        const warning = form.createDiv({ cls: "tra-inline-warning" });
        form.createDiv({ cls: "tra-scope-hint" });
        const addTagsSection = form.createDiv({ cls: "tra-add-tags-section" });
        const addTagsLabel = addTagsSection.createEl("label", {
            cls: "tra-field-label",
            text: `Добавить несколько тегов к заметкам с #${info.tag}`,
        });
        const addTagsRow = addTagsSection.createDiv({ cls: "tra-add-tags-row" });
        const addTagsInput = addTagsRow.createEl("textarea", {
            cls: "tra-add-tags-input",
            attr: {
                rows: "2",
                placeholder: "новый-тег1, новый-тег2",
                autocomplete: "off",
                spellcheck: "false",
                "aria-label": "Список добавляемых тегов",
                "data-tra-field": "add-tags",
            },
        });
        addTagsInput.value = this.renameDraft.addTags;
        addTagsInput.addEventListener("input", () => { this.renameDraft.addTags = addTagsInput.value; });
        addTagsLabel.setAttr("for", addTagsInput.id = `tra-add-tags-${Math.random().toString(36).slice(2, 9)}`);
        const addTagsButton = addTagsRow.createEl("button", {
            cls: "tra-primary-button tra-add-tags-submit",
            text: "Добавить в очередь",
            attr: { type: "button" },
        });
        addTagsSection.createEl("small", {
            cls: "tra-add-tags-help",
            text: "Разделяйте теги пробелами, запятыми или переносами строк. В YAML список расширяется; для тегов в тексте новые теги добавляются в конце соответствующей записи перед разделителем ---.",
        });
        addTagsButton.addEventListener("click", () => {
            if (this.plugin.addMultipleTagsChange(info.tag, addTagsInput.value, selectedNotes, this.postSelection)) {
                this.renameDraft.addTags = "";
                this.render();
            }
        });
        const destructiveActions = form.createDiv({ cls: "tra-destructive-actions" });
        const deleteButton = destructiveActions.createEl("button", {
            cls: "tra-danger-button",
            attr: { type: "button", title: `Добавить удаление #${info.tag} в очередь` },
        });
        const deleteIcon = deleteButton.createSpan({ cls: "tra-button-icon" });
        setIcon(deleteIcon, "trash-2");
        deleteButton.createSpan({ text: "Удалить тег из всех заметок" });
        const unmarkButton = destructiveActions.createEl("button", {
            cls: "tra-secondary-button tra-unmark-button",
            attr: { type: "button", title: `Сохранить # у #${info.tag} как обычный текст, не как тег` },
        });
        const unmarkIcon = unmarkButton.createSpan({ cls: "tra-button-icon" });
        setIcon(unmarkIcon, "hash");
        unmarkButton.createSpan({ text: "Оставить # как обычный текст" });
        destructiveActions.createEl("small", { text: "В тексте #тег останется видимым, но решётка будет экранирована обратным слешем (\\#тег), чтобы Obsidian не распознавал её как тег; запись из YAML tags/tag будет удалена из метаданных." });
        deleteButton.addEventListener("click", () => this.plugin.addDeleteTagChange(info.tag, selectedNotes, this.postSelection));
        unmarkButton.addEventListener("click", () => this.plugin.addUnmarkTagChange(info.tag, selectedNotes, this.postSelection));
        const updateWarning = () => {
            const value = cleanTagInput(input.value);
            warning.empty();
            warning.removeClass("is-error", "is-warning");
            if (!value)
                return;
            if (!isValidTag(value)) {
                warning.setText("Используйте буквы, цифры, `_`, `-` и `/`.");
                warning.addClass("is-error");
                return;
            }
            warning.removeClass("is-error");
            const target = this.plugin.getTagInfo(value);
            if (target && tagKey(value, this.plugin.settings.caseSensitive) !== info.key) {
                warning.setText(`#${value} уже существует. Теги будут объединены.`);
                warning.addClass("is-warning");
            }
        };
        input.addEventListener("input", () => {
            this.renameDraft.value = input.value;
            updateWarning();
        });
        updateWarning();
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                addButton.click();
            }
        });
        addButton.addEventListener("click", () => {
            const target = cleanTagInput(input.value);
            if (this.plugin.addOrUpdateChange(info.tag, target, selectedNotes, this.postSelection)) {
                this.selectedTag = info.tag;
                this.renameDraft.value = "";
                this.render();
            }
        });
        this.renderYearStats(card, info);
        const previewHeader = card.createDiv({ cls: "tra-preview-header" });
        const previewTitle = previewHeader.createDiv({ cls: "tra-preview-title" });
        setIcon(previewTitle.createSpan({ cls: "tra-preview-icon" }), "files");
        previewTitle.createEl("span", { text: "В заметках" });
        previewHeader.createSpan({ cls: "tra-note-selection-count" });
        const selectionBar = card.createDiv({ cls: "tra-note-selection-bar" });
        const selectAll = selectionBar.createEl("button", { cls: "tra-secondary-button tra-note-select-all", attr: { type: "button" } });
        setIcon(selectAll.createSpan({ cls: "tra-button-icon" }), "check-check");
        selectAll.createSpan({ text: "Выбрать все" });
        const selectNone = selectionBar.createEl("button", { cls: "tra-secondary-button tra-note-select-none", attr: { type: "button" } });
        setIcon(selectNone.createSpan({ cls: "tra-button-icon" }), "circle-x");
        selectNone.createSpan({ text: "Снять все" });
        selectionBar.createSpan({ cls: "tra-note-selection-hint", text: "Шапка карточки — выбрать заметку, текст — открыть её." });
        selectAll.addEventListener("click", () => {
            for (const file of info.files)
                selectedNotes.add(file.path);
            this.syncNoteSelectionUI(info);
        });
        selectNone.addEventListener("click", () => {
            selectedNotes.clear();
            this.syncNoteSelectionUI(info);
        });
        const previews = card.createDiv({ cls: "tra-preview-list" });
        this.renderPreviews(previews, info);
        this.syncNoteSelectionUI(info);
    }
    /**
     * Notes of the selected tag that queued operations will change. Defaults to
     * all notes (or the scope of an already queued change for this tag); notes
     * tagged later are selected automatically, vanished ones are dropped.
     */
    getNoteSelection(info) {
        const current = new Set(info.files.map((file) => file.path));
        const pending = this.plugin.pendingChanges.get(info.key) ?? this.plugin.pendingAdditions.get(info.key);
        // Start over for a new tag, and after the queued change for this tag was
        // applied or removed (otherwise "0 of N" would linger after applying).
        if (!this.noteSelection || this.noteSelection.key !== info.key || (this.noteSelection.hadPending && !pending)) {
            const paths = Array.isArray(pending?.paths) ? new Set(pending.paths.filter((path) => current.has(path))) : new Set(current);
            this.noteSelection = { key: info.key, paths, known: current, hadPending: Boolean(pending) };
            // Chosen records belong to this tag's selection (restored from a queued change).
            this.postSelection = new Map(Object.entries(pending?.posts ?? {}).filter(([path]) => current.has(path)));
            return paths;
        }
        this.noteSelection.hadPending = Boolean(pending);
        const { paths, known } = this.noteSelection;
        for (const path of current) {
            if (!known.has(path))
                paths.add(path);
        }
        for (const path of [...paths]) {
            if (!current.has(path))
                paths.delete(path);
        }
        this.noteSelection.known = current;
        return paths;
    }
    toggleNoteSelection(info, path) {
        const paths = this.getNoteSelection(info);
        if (paths.has(path))
            paths.delete(path);
        else
            paths.add(path);
        this.syncNoteSelectionUI(info);
    }
    syncNoteSelectionUI(info) {
        const root = this.contentEl;
        const paths = this.getNoteSelection(info);
        const total = info.files.length;
        const selected = paths.size;
        root.querySelector(".tra-note-selection-count")?.setText(`Выбрано ${selected} из ${total}`);
        const selectAll = root.querySelector(".tra-note-select-all");
        if (selectAll)
            selectAll.disabled = selected === total;
        const selectNone = root.querySelector(".tra-note-select-none");
        if (selectNone)
            selectNone.disabled = selected === 0;
        const hint = root.querySelector(".tra-scope-hint");
        if (hint) {
            hint.setText(selected === total
                ? `Действия применятся ко всем ${total} ${pluralRu(total, "заметке", "заметкам", "заметкам")} с тегом.`
                : `Действия применятся только к отмеченным заметкам: ${selected} из ${total}.`);
            hint.classList.toggle("is-partial", selected !== total);
        }
        for (const card of Array.from(root.querySelectorAll(".tra-file-card[data-path]"))) {
            const isSelected = paths.has(card.getAttribute("data-path"));
            updatePostBadge(card, isSelected ? this.postSelection.get(card.getAttribute("data-path")) : null);
            card.classList.toggle("is-excluded", !isSelected);
            const checkbox = card.querySelector(".tra-file-check");
            if (checkbox)
                checkbox.checked = isSelected;
        }
    }
    /**
     * Notes with the tag per year (by the current date source). A click on a year
     * opens "Заметки по датам" filtered to that year and tag.
     */
    renderYearStats(card, info) {
        const counts = new Map();
        let undated = 0;
        for (const file of info.files) {
            const time = this.getNoteCreationTimestamp(file);
            if (!time) {
                undated += 1;
                continue;
            }
            const year = new Date(time).getUTCFullYear();
            counts.set(year, (counts.get(year) ?? 0) + 1);
        }
        const section = card.createDiv({ cls: "tra-year-stats" });
        const header = section.createDiv({ cls: "tra-year-header" });
        const title = header.createDiv({ cls: "tra-preview-title" });
        setIcon(title.createSpan({ cls: "tra-preview-icon" }), "bar-chart-3");
        title.createSpan({ text: "По годам" });
        header.createSpan({ cls: "tra-year-source", text: this.plugin.describeDateSource() });
        if (counts.size === 0) {
            section.createDiv({ cls: "tra-year-empty", text: "Ни у одной заметки с тегом нет даты в выбранном источнике." });
            return;
        }
        const years = [...counts.keys()].sort((a, b) => a - b);
        const first = years[0];
        const last = years[years.length - 1];
        // Show empty years inside the range too, unless the range is huge (e.g. a stray 1970).
        const range = last - first <= 40 ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : years;
        const max = Math.max(...counts.values());
        const labelStep = range.length > 24 ? Math.ceil(range.length / 12) : 1;
        const chart = section.createDiv({ cls: "tra-year-chart", attr: { role: "list" } });
        range.forEach((year, index) => {
            const count = counts.get(year) ?? 0;
            const bar = chart.createEl("button", {
                cls: `tra-year-bar${count === 0 ? " is-empty" : ""}`,
                attr: {
                    type: "button",
                    role: "listitem",
                    title: count ? `${year}: ${count} ${pluralRu(count, "заметка", "заметки", "заметок")} — открыть в «Заметках по датам»` : `${year}: нет заметок`,
                    "aria-label": `${year}: ${count}`,
                },
            });
            bar.disabled = count === 0;
            bar.createSpan({ cls: "tra-year-count", text: count ? String(count) : "" });
            const track = bar.createSpan({ cls: "tra-year-track" });
            const fill = track.createSpan({ cls: "tra-year-fill" });
            fill.style.height = `${count ? Math.max(6, Math.round((count / max) * 100)) : 0}%`;
            bar.createSpan({ cls: "tra-year-label", text: index % labelStep === 0 || index === range.length - 1 ? String(year) : "" });
            bar.addEventListener("click", () => this.openYearInBulk(year, info.tag));
        });
        if (undated > 0)
            section.createDiv({ cls: "tra-year-empty", text: `Без даты: ${undated} ${pluralRu(undated, "заметка", "заметки", "заметок")}.` });
    }
    openYearInBulk(year, tag) {
        this.bulkDateFrom = `${year}-01-01`;
        this.bulkDateTo = `${year}-12-31`;
        this.bulkTagMode = "all";
        this.bulkIncludeTags.splice(0, this.bulkIncludeTags.length, tag);
        this.bulkExcludeTags.splice(0, this.bulkExcludeTags.length);
        this.bulkFolder = "";
        this.bulkTextQuery = "";
        this.bulkTextMatches = null;
        this.bulkFilterApplied = true;
        this.bulkSelectedPaths.clear();
        this.bulkPostSelection.clear();
        this.bulkVisibleFiles = [];
        this.bulkRenderLimit = BULK_PAGE_SIZE;
        this.activePage = "bulk";
        this.render();
        this.contentEl.scrollTop = 0;
    }
    openNotePreview(file, highlightTag, selection, info = null) {
        const posts = info ? {
            get: () => this.postSelection.get(file.path) ?? null,
            set: (value) => {
                if (value)
                    this.postSelection.set(file.path, value);
                else
                    this.postSelection.delete(file.path);
                this.syncNoteSelectionUI(info);
            },
        } : undefined;
        new NotePreviewModal(this.plugin.app, file, { plugin: this.plugin, highlightTag, selection, posts }).open();
    }
    renderPreviews(parent, info) {
        const files = info.files;
        const limit = this.showAllPreviews ? files.length : Math.min(files.length, PREVIEW_PAGE_SIZE);
        for (const file of files.slice(0, limit)) {
            const item = parent.createDiv({
                cls: "tra-file-card is-clickable",
                attr: { role: "button", tabindex: "0", "aria-label": `Просмотреть заметку ${file.basename}`, "data-path": file.path },
            });
            const selection = {
                isSelected: () => this.getNoteSelection(info).has(file.path),
                toggle: () => this.toggleNoteSelection(info, file.path),
            };
            const openPreview = () => this.openNotePreview(file, info.tag, selection, info);
            // Two click zones: the header (title, path) toggles the checkbox,
            // the text opens the note in a window.
            item.addEventListener("click", (event) => {
                const target = event.target instanceof Element ? event.target : null;
                // External links open in the browser; the checkbox handles itself.
                if (target?.closest("a.external-link, .tra-file-check"))
                    return;
                if (target?.closest(".tra-file-title-row, .tra-file-path"))
                    selection.toggle();
                else
                    openPreview();
            });
            item.addEventListener("keydown", (event) => {
                if (event.target !== item)
                    return;
                if (event.key === "Enter") {
                    event.preventDefault();
                    openPreview();
                }
                else if (event.key === " ") {
                    event.preventDefault();
                    selection.toggle();
                }
            });
            const titleRow = item.createDiv({ cls: "tra-file-title-row" });
            const checkbox = titleRow.createEl("input", { cls: "tra-file-check", attr: { type: "checkbox", title: "Изменять эту заметку", "aria-label": `Изменять заметку ${file.basename}` } });
            checkbox.addEventListener("click", (event) => event.stopPropagation());
            checkbox.addEventListener("change", () => {
                if (checkbox.checked !== selection.isSelected())
                    selection.toggle();
            });
            const docIcon = titleRow.createDiv({ cls: "tra-file-icon" });
            setIcon(docIcon, "file-text");
            const link = titleRow.createSpan({ cls: "tra-file-link", text: file.basename });
            link.setAttr("title", file.path);
            titleRow.createSpan({ cls: "tra-post-badge" });
            titleRow.setAttr("title", "Выбрать или снять выбор");
            const path = item.createDiv({ cls: "tra-file-path", text: file.path });
            // Keep the path available to screen readers even when the title is short.
            path.setAttr("aria-label", file.path);
            const excerptEl = item.createDiv({ cls: "tra-excerpt markdown-rendered", attr: { title: "Открыть заметку" } });
            this.renderWhenVisible(excerptEl, () => this.renderPreviewExcerpt(excerptEl, file, info.tag));
        }
        if (files.length > limit) {
            const more = parent.createEl("button", {
                cls: "tra-show-more",
                text: `Показать ещё ${files.length - limit}`,
                attr: { type: "button" },
            });
            more.addEventListener("click", () => {
                this.showAllPreviews = true;
                this.render();
            });
        }
        else if (this.showAllPreviews && files.length > PREVIEW_PAGE_SIZE) {
            const less = parent.createEl("button", { cls: "tra-show-more", text: "Свернуть список", attr: { type: "button" } });
            less.addEventListener("click", () => {
                this.showAllPreviews = false;
                this.render();
            });
        }
    }
    async renderPreviewExcerpt(excerptEl, file, tag) {
        const component = this.renderComponent;
        try {
            const raw = await this.plugin.app.vault.cachedRead(file);
            // A newer render replaced this card while the file was being read.
            if (!excerptEl.isConnected || component !== this.renderComponent)
                return;
            const withoutFrontmatter = stripFrontmatter(raw);
            const caseSensitive = this.plugin.settings.caseSensitive;
            const tagIndex = findInlineTagIndex(withoutFrontmatter, tag, caseSensitive);
            const plainIndex = tagIndex >= 0 ? tagIndex : findTextIndex(withoutFrontmatter, tag, caseSensitive);
            const maxChars = this.plugin.settings.previewChars;
            const start = plainIndex >= 0 ? Math.max(0, plainIndex - Math.floor(maxChars * 0.28)) : 0;
            const excerpt = withoutFrontmatter.slice(start, start + maxChars);
            const renderedExcerpt = `${start > 0 ? "…\n\n" : ""}${excerpt}${start + maxChars < withoutFrontmatter.length ? "\n\n…" : ""}`;
            // Render the snippet with Obsidian's Markdown engine, so headings,
            // lists, emphasis, links, tables, and other Markdown syntax appear as layout.
            await MarkdownRenderer.render(this.plugin.app, renderedExcerpt, excerptEl, file.path, component);
            this.highlightRenderedTag(excerptEl, tag);
        }
        catch {
            if (excerptEl.isConnected) {
                excerptEl.empty();
                excerptEl.addClass("tra-muted");
                excerptEl.setText("Не удалось прочитать заметку.");
            }
        }
    }
    highlightRenderedTag(container, tag) {
        highlightTagInElement(container, tag, this.plugin.settings.caseSensitive);
    }
    renderPendingChanges(root) {
        const changes = this.plugin.getPendingChanges();
        const section = root.createDiv({ cls: "tra-queue-card" });
        const header = section.createDiv({ cls: "tra-queue-header" });
        const titleGroup = header.createDiv({ cls: "tra-queue-title-group" });
        const icon = titleGroup.createDiv({ cls: "tra-queue-icon" });
        setIcon(icon, "git-pull-request");
        const title = titleGroup.createDiv();
        title.createEl("h3", { text: "На изменение" });
        title.createEl("p", { text: "Проверьте список перед применением" });
        header.createSpan({ cls: "tra-queue-count", text: String(changes.length) });
        if (changes.length === 0) {
            const empty = section.createDiv({ cls: "tra-queue-empty" });
            empty.createEl("span", { text: "Очередь пока пуста" });
            empty.createEl("small", { text: "Выберите тег, чтобы переименовать, удалить, снять маркировку # или добавить связанные теги в заметки." });
            return;
        }
        const list = section.createDiv({ cls: "tra-queue-list" });
        for (const change of changes) {
            const row = list.createDiv({ cls: "tra-queue-row" });
            const mapping = row.createDiv({ cls: "tra-queue-mapping" });
            mapping.createDiv({ cls: "tra-queue-old", text: `#${change.oldTag}` });
            if (change.action === "add") {
                const addTarget = mapping.createDiv({ cls: "tra-queue-add" });
                setIcon(addTarget.createSpan(), "plus");
                addTarget.createSpan({ text: `Добавить ${change.addTags.map((tag) => `#${tag}`).join(" ")}` });
            }
            else if (change.action === "delete" || change.newTag === null) {
                const deleteTarget = mapping.createDiv({ cls: "tra-queue-delete" });
                setIcon(deleteTarget.createSpan(), "trash-2");
                deleteTarget.createSpan({ text: "Удалить тег" });
            }
            else if (change.action === "unmark") {
                const unmarkTarget = mapping.createDiv({ cls: "tra-queue-unmark" });
                setIcon(unmarkTarget.createSpan(), "hash");
                unmarkTarget.createSpan({ text: "Оставить # как текст" });
            }
            else {
                const arrow = mapping.createDiv({ cls: "tra-queue-arrow" });
                setIcon(arrow.createSpan(), "arrow-right");
                mapping.createDiv({ cls: "tra-queue-new", text: `#${change.newTag}` });
            }
            const info = this.plugin.getTagInfo(change.oldTag);
            const total = info?.files.length ?? 0;
            const scoped = Array.isArray(change.paths) ? this.plugin.filesForChange(change).length : null;
            const withPosts = change.posts ? Object.keys(change.posts).length : 0;
            row.createDiv({
                cls: `tra-queue-files${scoped !== null || withPosts ? " is-partial" : ""}`,
                attr: withPosts ? { title: `В ${withPosts} ${pluralRu(withPosts, "заметке", "заметках", "заметках")} изменятся только выбранные записи` } : {},
                text: scoped !== null
                    ? `${scoped} из ${total} ${pluralRu(total, "заметки", "заметок", "заметок")}`
                    : `${total} ${pluralRu(total, "заметка", "заметки", "заметок")}`,
            });
            const remove = row.createEl("button", { cls: "tra-remove-change", attr: { type: "button", title: "Убрать из очереди", "aria-label": `Убрать #${change.oldTag}` } });
            setIcon(remove, "x");
            remove.addEventListener("click", () => this.plugin.removeChange(change.oldTag, change.action));
        }
        const totalFiles = this.plugin.affectedFiles(changes).length;
        const footer = section.createDiv({ cls: "tra-queue-footer" });
        footer.createSpan({ cls: "tra-queue-total", text: `${totalFiles} ${pluralRu(totalFiles, "файл", "файла", "файлов")} затронуто` });
        const actions = section.createDiv({ cls: "tra-queue-actions" });
        const clear = actions.createEl("button", { cls: "tra-secondary-button", text: "Очистить" });
        clear.type = "button";
        clear.addEventListener("click", () => this.plugin.clearChanges());
        const apply = actions.createEl("button", { cls: "tra-primary-button tra-apply-button" });
        apply.type = "button";
        const applyIcon = apply.createSpan({ cls: "tra-button-icon" });
        setIcon(applyIcon, "check-check");
        apply.createSpan({ text: "Применить" });
        apply.addEventListener("click", () => {
            const mergedTargets = this.plugin.existingMergeTargets(changes);
            const files = this.plugin.affectedFiles(changes);
            new ApplyConfirmModal(this.plugin.app, this.plugin, changes, files, mergedTargets, (selectedPaths) => this.plugin.applyQueuedChanges(selectedPaths)).open();
        });
    }
}

module.exports = { AuditPageMixin };
};

/* ===== src/view/bulk-page.js ===== */
EMBEDDED_MODULES["view/bulk-page.js"] = function (module, exports, require) {
"use strict";
/** Страница «Заметки по датам»: фильтр, выбор карточек и массовые операции. */
const { MarkdownRenderer, Notice, setIcon } = require("obsidian");
const { BULK_PAGE_SIZE } = require("../constants.js");
const { BulkApplyConfirmModal } = require("../modals/bulk-apply-confirm-modal.js");
const { NotePreviewModal } = require("../modals/note-preview-modal.js");
const { makeIgnoredPathMatcher } = require("../scanner.js");
const { stripFrontmatter } = require("../tags/frontmatter.js");
const { cleanTagInput, isValidTag, normalizeTag, tagKey } = require("../tags/tag-name.js");
const { pluralRu, updatePostBadge } = require("../utils.js");

/** Методы подмешиваются в TagAuditorView. */
class BulkPageMixin {
    getBulkFilteredFiles() {
        const isIgnored = makeIgnoredPathMatcher(this.plugin.settings.ignoredFolders ?? []);
        const caseSensitive = this.plugin.settings.caseSensitive;
        const fromTime = this.bulkDateFrom ? Date.parse(`${this.bulkDateFrom}T00:00:00.000Z`) : null;
        const toTime = this.bulkDateTo ? Date.parse(`${this.bulkDateTo}T23:59:59.999Z`) : null;
        const folder = this.bulkFolder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const keysOf = (tags) => tags.map((tag) => tagKey(tag, caseSensitive));
        const include = keysOf(this.bulkIncludeTags);
        const exclude = new Set(keysOf(this.bulkExcludeTags));
        const mode = this.bulkTagMode;
        return this.plugin.app.vault.getMarkdownFiles()
            .filter((file) => !isIgnored(file.path))
            .filter((file) => !folder || file.path === folder || file.path.startsWith(`${folder}/`))
            .filter((file) => {
                if (fromTime === null && toTime === null)
                    return true;
                const created = this.getNoteCreationTimestamp(file);
                if (!created)
                    return false;
                if (fromTime !== null && created < fromTime)
                    return false;
                if (toTime !== null && created > toTime)
                    return false;
                return true;
            })
            .filter((file) => {
                const keys = new Set(keysOf(this.getTagsForFile(file)));
                if (mode === "none" && keys.size > 0)
                    return false;
                if (mode === "all" && !include.every((key) => keys.has(key)))
                    return false;
                if (mode === "some" && !include.some((key) => keys.has(key)))
                    return false;
                for (const key of exclude) {
                    if (keys.has(key))
                        return false;
                }
                return true;
            })
            .filter((file) => !this.bulkTextMatches || this.bulkTextMatches.has(file.path))
            .sort((a, b) => this.compareByCreation(a, b));
    }
    /** Paths of notes whose name or text contains `query` (case-insensitive). */
    async findTextMatches(query) {
        const needle = query.trim().toLocaleLowerCase();
        const isIgnored = makeIgnoredPathMatcher(this.plugin.settings.ignoredFolders ?? []);
        const matches = new Set();
        const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => !isIgnored(file.path));
        // Read in small parallel batches to keep the UI responsive on large vaults.
        for (let i = 0; i < files.length; i += 50) {
            await Promise.all(files.slice(i, i + 50).map(async (file) => {
                if (file.basename.toLocaleLowerCase().includes(needle)) {
                    matches.add(file.path);
                    return;
                }
                try {
                    const text = await this.plugin.app.vault.cachedRead(file);
                    if (text.toLocaleLowerCase().includes(needle))
                        matches.add(file.path);
                }
                catch {
                    // Unreadable files simply do not match.
                }
            }));
        }
        return matches;
    }
    getVaultFolders() {
        const folders = new Set();
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            const parts = file.path.split("/");
            for (let i = 1; i < parts.length; i += 1)
                folders.add(parts.slice(0, i).join("/"));
        }
        return [...folders].sort((a, b) => a.localeCompare(b));
    }
    /** Chips + input with tag autocomplete; `values` is edited in place. */
    renderTagChipsInput(parent, labelText, values, field, onChange) {
        const id = `tra-${field}`;
        parent.createEl("label", { text: labelText, attr: { for: id } });
        const box = parent.createDiv({ cls: "tra-chip-input" });
        const chips = box.createDiv({ cls: "tra-chip-list" });
        const input = box.createEl("input", { attr: { id, type: "text", list: "tra-bulk-tag-options", placeholder: "Добавить тег…", autocomplete: "off", spellcheck: "false", "data-tra-field": field } });
        const renderChips = () => {
            chips.empty();
            for (const tag of values) {
                const chip = chips.createSpan({ cls: "tra-chip", text: `#${tag}` });
                const remove = chip.createEl("button", { cls: "tra-chip-remove", attr: { type: "button", "aria-label": `Убрать #${tag}` }, text: "×" });
                remove.addEventListener("click", () => {
                    values.splice(values.indexOf(tag), 1);
                    renderChips();
                    onChange();
                });
            }
        };
        const commit = () => {
            const raw = input.value.split(/[\s,;]+/).map((item) => normalizeTag(cleanTagInput(item))).filter(Boolean);
            if (raw.length === 0)
                return;
            const unknown = [];
            for (const tag of raw) {
                const info = this.plugin.getTagInfo(tag);
                if (!info) {
                    unknown.push(tag);
                    continue;
                }
                if (!values.some((value) => tagKey(value, this.plugin.settings.caseSensitive) === info.key))
                    values.push(info.tag);
            }
            input.value = unknown.join(" ");
            if (unknown.length)
                new Notice(`Нет таких тегов: ${unknown.map((tag) => `#${tag}`).join(", ")}`);
            renderChips();
            onChange();
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commit();
            }
            else if (event.key === "Backspace" && input.value === "" && values.length > 0) {
                values.pop();
                renderChips();
                onChange();
            }
        });
        // Picking an option from the autocomplete list.
        input.addEventListener("input", (event) => {
            if (event.inputType === "insertReplacementText" || (event.inputType === undefined && this.plugin.getTagInfo(cleanTagInput(input.value))))
                commit();
        });
        input.addEventListener("blur", () => {
            if (input.value.trim())
                commit();
        });
        renderChips();
    }
    /** Notes with a date first (newest or oldest first), undated notes last. */
    compareByCreation(a, b) {
        const timeA = this.getNoteCreationTimestamp(a);
        const timeB = this.getNoteCreationTimestamp(b);
        if (!timeA && timeB)
            return 1;
        if (timeA && !timeB)
            return -1;
        const delta = timeA - timeB;
        return (this.bulkDateSort === "oldest" ? delta : -delta) || a.path.localeCompare(b.path);
    }
    renderBulkManagement(shell) {
        const intro = shell.createDiv({ cls: "tra-bulk-intro" });
        intro.createEl("h3", { text: "Управление заметками по датам" });
        intro.createEl("p", { text: "Отберите заметки по дате, выделите нужные карточки и выполните одну операцию над тегами только в выбранных файлах." });

        const layout = shell.createDiv({ cls: "tra-bulk-layout" });
        const controls = layout.createDiv({ cls: "tra-bulk-controls-card" });
        const controlsHeader = controls.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(controlsHeader.createSpan({ cls: "tra-bulk-heading-icon" }), "sliders-horizontal");
        controlsHeader.createEl("h3", { text: "Параметры операции" });

        const dateGroup = controls.createDiv({ cls: "tra-bulk-form-group" });
        dateGroup.createEl("span", { cls: "tra-bulk-label", text: "Дата заметки" });
        const dateRow = dateGroup.createDiv({ cls: "tra-bulk-date-row" });
        const fromWrap = dateRow.createDiv({ cls: "tra-bulk-date-field" });
        fromWrap.createEl("label", { text: "От", attr: { for: "tra-bulk-date-from" } });
        const fromInput = fromWrap.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-date-from", type: "date", "aria-label": "Дата создания от" } });
        fromInput.value = this.bulkDateFrom;
        const toWrap = dateRow.createDiv({ cls: "tra-bulk-date-field" });
        toWrap.createEl("label", { text: "До", attr: { for: "tra-bulk-date-to" } });
        const toInput = toWrap.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-date-to", type: "date", "aria-label": "Дата создания до" } });
        toInput.value = this.bulkDateTo;
        const sourceField = dateGroup.createDiv({ cls: "tra-bulk-date-source" });
        sourceField.createEl("label", { text: "Источник даты", attr: { for: "tra-bulk-date-source" } });
        const sourceSelect = sourceField.createEl("select", { cls: "tra-bulk-input", attr: { id: "tra-bulk-date-source", "aria-label": "Источник даты заметки" } });
        this.fillDateSourceOptions(sourceSelect);
        const dateHint = dateGroup.createDiv({ cls: "tra-bulk-hint tra-bulk-date-stats" });
        this.renderDateStats(dateHint);
        sourceSelect.addEventListener("change", async () => {
            await this.plugin.setDateSource(sourceSelect.value);
            this.renderDateStats(dateHint);
            invalidateBulkFilter();
        });
        const filterGroup = controls.createDiv({ cls: "tra-bulk-form-group tra-bulk-filter-group" });
        filterGroup.createEl("span", { cls: "tra-bulk-label", text: "Фильтры" });
        // Shared autocomplete list of existing tags for all tag inputs.
        const tagOptions = filterGroup.createEl("datalist", { attr: { id: "tra-bulk-tag-options" } });
        for (const info of this.plugin.tagIndex.values())
            tagOptions.createEl("option", { attr: { value: info.tag } });

        const folderField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        folderField.createEl("label", { text: "Папка", attr: { for: "tra-bulk-folder" } });
        const folderInput = folderField.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-folder", type: "text", list: "tra-bulk-folder-options", placeholder: "Все папки", autocomplete: "off", spellcheck: "false", "data-tra-field": "bulk-folder" } });
        folderInput.value = this.bulkFolder;
        const folderOptions = folderField.createEl("datalist", { attr: { id: "tra-bulk-folder-options" } });
        for (const folder of this.getVaultFolders())
            folderOptions.createEl("option", { attr: { value: folder } });

        const modeField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        modeField.createEl("label", { text: "Теги", attr: { for: "tra-bulk-tag-mode" } });
        const modeSelect = modeField.createEl("select", { cls: "tra-bulk-input", attr: { id: "tra-bulk-tag-mode" } });
        for (const [value, label] of [["any", "Любые (не фильтровать)"], ["none", "Без тегов"], ["all", "Есть все теги из списка"], ["some", "Есть любой тег из списка"]])
            modeSelect.createEl("option", { text: label, attr: { value } });
        modeSelect.value = this.bulkTagMode;
        const includeField = filterGroup.createDiv({ cls: "tra-bulk-filter-field tra-bulk-include-field" });
        this.renderTagChipsInput(includeField, "Список тегов", this.bulkIncludeTags, "bulk-include", () => invalidateBulkFilter());
        const excludeField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        this.renderTagChipsInput(excludeField, "Исключить заметки с тегами", this.bulkExcludeTags, "bulk-exclude", () => invalidateBulkFilter());
        const syncModeFields = () => {
            includeField.style.display = this.bulkTagMode === "all" || this.bulkTagMode === "some" ? "" : "none";
        };
        syncModeFields();

        const textField = filterGroup.createDiv({ cls: "tra-bulk-filter-field" });
        textField.createEl("label", { text: "Текст в названии или заметке", attr: { for: "tra-bulk-text" } });
        const textInput = textField.createEl("input", { cls: "tra-bulk-input", attr: { id: "tra-bulk-text", type: "search", placeholder: "Например: шлагбаум", spellcheck: "false", "data-tra-field": "bulk-text" } });
        textInput.value = this.bulkTextQuery;

        const applyFilterButton = filterGroup.createEl("button", { cls: "tra-primary-button tra-bulk-filter-apply", attr: { type: "button" } });
        setIcon(applyFilterButton.createSpan({ cls: "tra-button-icon" }), "filter");
        applyFilterButton.createSpan({ text: "Применить фильтр" });
        const invalidateBulkFilter = () => {
            this.bulkFilterApplied = false;
            this.bulkSelectedPaths.clear();
            this.bulkPostSelection.clear();
            this.bulkVisibleFiles = [];
            const root = this.contentEl;
            const list = root.querySelector(".tra-bulk-note-list");
            if (list) {
                list.empty();
                list.createDiv({ cls: "tra-bulk-empty tra-bulk-filter-placeholder", text: "Настройте фильтры и нажмите «Применить фильтр», чтобы загрузить карточки заметок." });
            }
            const countBadge = root.querySelector(".tra-bulk-results-count");
            if (countBadge)
                countBadge.setText("—");
            this.syncBulkSelectionUI();
        };
        applyFilterButton.addEventListener("click", async () => {
            if (this.bulkDateFrom && this.bulkDateTo && this.bulkDateFrom > this.bulkDateTo) {
                new Notice("Дата «От» не может быть позже даты «До».");
                return;
            }
            if ((this.bulkTagMode === "all" || this.bulkTagMode === "some") && this.bulkIncludeTags.length === 0) {
                new Notice("Добавьте в список хотя бы один тег или выберите «Любые».");
                return;
            }
            applyFilterButton.disabled = true;
            try {
                // Text search reads note contents, so it runs once here and is cached.
                this.bulkTextMatches = this.bulkTextQuery.trim() ? await this.findTextMatches(this.bulkTextQuery) : null;
            }
            finally {
                applyFilterButton.disabled = false;
            }
            this.bulkFilterApplied = true;
            this.bulkSelectedPaths.clear();
            this.bulkPostSelection.clear();
            this.bulkVisibleFiles = [];
            this.bulkRenderLimit = BULK_PAGE_SIZE;
            this.render();
        });
        const updateDateRange = () => {
            this.bulkDateFrom = fromInput.value;
            this.bulkDateTo = toInput.value;
            // Preserve native date inputs while the user is entering a date.
            // Filter validation happens only when the apply button is pressed.
            invalidateBulkFilter();
        };
        fromInput.addEventListener("change", updateDateRange);
        toInput.addEventListener("change", updateDateRange);
        folderInput.addEventListener("input", () => {
            this.bulkFolder = folderInput.value;
            invalidateBulkFilter();
        });
        modeSelect.addEventListener("change", () => {
            this.bulkTagMode = modeSelect.value;
            syncModeFields();
            invalidateBulkFilter();
        });
        textInput.addEventListener("input", () => {
            this.bulkTextQuery = textInput.value;
            invalidateBulkFilter();
        });
        textInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter")
                applyFilterButton.click();
        });

        const actionGroup = controls.createDiv({ cls: "tra-bulk-form-group" });
        actionGroup.createEl("label", { cls: "tra-bulk-label", text: "Операция", attr: { for: "tra-bulk-action" } });
        const actionSelect = actionGroup.createEl("select", { cls: "tra-bulk-input", attr: { id: "tra-bulk-action", "aria-label": "Тип массовой операции" } });
        actionSelect.createEl("option", { text: "Добавить теги", attr: { value: "add" } });
        actionSelect.createEl("option", { text: "Переименовать теги", attr: { value: "rename" } });
        actionSelect.createEl("option", { text: "Удалить теги", attr: { value: "delete" } });
        actionSelect.createEl("option", { text: "Перенести теги из текста в свойства (YAML)", attr: { value: "to-yaml" } });
        actionSelect.createEl("option", { text: "Перенести теги из свойств (YAML) в текст", attr: { value: "to-text" } });
        actionSelect.value = this.bulkAction;

        const addFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        const addLabel = addFields.createEl("label", { cls: "tra-bulk-label", text: "Теги для добавления", attr: { for: "tra-bulk-add-input" } });
        const addInput = addFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-add-input", "data-tra-field": "bulk-add", rows: "4", placeholder: "новый-тег1, новый-тег2\nновый-тег3", spellcheck: "false" } });
        addInput.value = this.bulkInputs.add;
        addLabel.setAttr("for", addInput.id);
        addInput.addEventListener("input", () => { this.bulkInputs.add = addInput.value; });
        const alwaysYamlLabel = addFields.createEl("label", { cls: "tra-bulk-always-yaml" });
        const alwaysYamlCheckbox = alwaysYamlLabel.createEl("input", { attr: { type: "checkbox", "aria-label": "Всегда добавлять в атрибуты" } });
        alwaysYamlCheckbox.checked = this.bulkAlwaysAddToAttributes;
        alwaysYamlLabel.createSpan({ text: "Всегда добавлять в атрибуты" });
        alwaysYamlCheckbox.addEventListener("change", () => { this.bulkAlwaysAddToAttributes = alwaysYamlCheckbox.checked; });
        addFields.createDiv({ cls: "tra-bulk-hint", text: "По умолчанию теги добавляются в существующие YAML-атрибуты tag/tags, а при их отсутствии — в текст заметки." });

        const renameFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        const renameLabel = renameFields.createEl("label", { cls: "tra-bulk-label", text: "Соответствия старый → новый", attr: { for: "tra-bulk-rename-input" } });
        const renameInput = renameFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-rename-input", "data-tra-field": "bulk-rename", rows: "4", placeholder: "старый-тег -> новый-тег\nдругой -> новое-имя", spellcheck: "false" } });
        renameInput.value = this.bulkInputs.rename;
        renameInput.addEventListener("input", () => { this.bulkInputs.rename = renameInput.value; });
        renameFields.createDiv({ cls: "tra-bulk-hint", text: "Одна пара на строку. Затрагиваются только выбранные заметки." });

        const deleteFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        const deleteLabel = deleteFields.createEl("label", { cls: "tra-bulk-label", text: "Теги для удаления", attr: { for: "tra-bulk-delete-input" } });
        const deleteInput = deleteFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-delete-input", "data-tra-field": "bulk-delete", rows: "4", placeholder: "тег1, тег2", spellcheck: "false" } });
        deleteInput.value = this.bulkInputs.delete;
        deleteInput.addEventListener("input", () => { this.bulkInputs.delete = deleteInput.value; });
        deleteFields.createDiv({ cls: "tra-bulk-hint", text: "Будут удалены сами упоминания тегов и соответствующие записи YAML." });

        const moveFields = actionGroup.createDiv({ cls: "tra-bulk-action-fields" });
        moveFields.createEl("label", { cls: "tra-bulk-label", text: "Какие теги переносить", attr: { for: "tra-bulk-move-input" } });
        const moveInput = moveFields.createEl("textarea", { cls: "tra-bulk-textarea", attr: { id: "tra-bulk-move-input", "data-tra-field": "bulk-move", rows: "3", placeholder: "Пусто — все теги", spellcheck: "false" } });
        moveInput.value = this.bulkInputs.move ?? "";
        moveInput.addEventListener("input", () => { this.bulkInputs.move = moveInput.value; });
        const moveHint = moveFields.createDiv({ cls: "tra-bulk-hint" });

        const switchActionFields = () => {
            moveFields.style.display = this.bulkAction === "to-yaml" || this.bulkAction === "to-text" ? "block" : "none";
            moveHint.setText(this.bulkAction === "to-yaml"
                ? "Теги из текста удаляются (строки, где были только теги, тоже) и записываются в свойство tags; если его нет, оно создаётся. При выборе отдельных записей переносятся теги только из них."
                : "Теги удаляются из свойств tag/tags и добавляются строкой #тег в конец последней записи (перед завершающим ---). При выборе отдельных записей строка добавляется в каждую выбранную запись.");
            addFields.style.display = this.bulkAction === "add" ? "block" : "none";
            renameFields.style.display = this.bulkAction === "rename" ? "block" : "none";
            deleteFields.style.display = this.bulkAction === "delete" ? "block" : "none";
        };
        actionSelect.addEventListener("change", () => {
            this.bulkAction = actionSelect.value;
            switchActionFields();
        });
        switchActionFields();

        const selectedSummary = controls.createDiv({ cls: "tra-bulk-selected-summary" });
        selectedSummary.createDiv({ cls: "tra-bulk-selected-count", text: "Выбрано 0 заметок" });
        const applyButton = controls.createEl("button", { cls: "tra-primary-button tra-bulk-apply", attr: { type: "button" } });
        setIcon(applyButton.createSpan({ cls: "tra-button-icon" }), "check-check");
        applyButton.createSpan({ text: "Применить к выбранным" });
        applyButton.disabled = this.bulkSelectedPaths.size === 0;
        applyButton.addEventListener("click", () => {
            const files = this.bulkVisibleFiles.filter((file) => this.bulkSelectedPaths.has(file.path));
            if (files.length === 0) {
                new Notice("Сначала выберите заметки для изменения.");
                return;
            }
            const payload = this.parseBulkOperation();
            if (!payload)
                return;
            let operationTitle = "";
            let operationDetails = "";
            const tagList = (tags) => tags.map((tag) => `#${tag}`).join(", ");
            if (payload.kind === "add") {
                operationTitle = "Добавление тегов";
                operationDetails = payload.alwaysYaml
                    ? `Добавить ${tagList(payload.tags)} в YAML-атрибут tag/tags. Если атрибутов нет, будет создано поле tags.`
                    : `Добавить ${tagList(payload.tags)}. Если в заметке есть YAML-поле tag/tags, оно будет расширено; иначе теги будут добавлены в текст записи.`;
            }
            else if (payload.kind === "rename") {
                operationTitle = "Переименование тегов";
                operationDetails = payload.changes.map((change) => `#${change.oldTag} → #${change.newTag}`).join("; ");
            }
            else if (payload.kind === "delete") {
                operationTitle = "Удаление тегов";
                operationDetails = `Удалить ${tagList(payload.changes.map((change) => change.oldTag))} из выбранных заметок.`;
            }
            else if (payload.kind === "to-yaml") {
                operationTitle = "Перенос тегов из текста в свойства";
                operationDetails = payload.tags.length ? `Перенести ${tagList(payload.tags)} из текста в YAML-свойство tags.` : "Перенести все теги из текста в YAML-свойство tags.";
            }
            else {
                operationTitle = "Перенос тегов из свойств в текст";
                operationDetails = payload.tags.length ? `Перенести ${tagList(payload.tags)} из YAML tag/tags в текст заметки.` : "Перенести все теги из YAML tag/tags в текст заметки.";
            }
            const withPosts = payload.posts ? Object.keys(payload.posts).length : 0;
            if (withPosts)
                operationDetails += ` В ${withPosts} ${pluralRu(withPosts, "заметке", "заметках", "заметках")} изменения затронут только выбранные записи.`;
            new BulkApplyConfirmModal(this.plugin.app, this.plugin, {
                files,
                title: operationTitle,
                details: operationDetails,
                isDestructive: payload.kind !== "add",
                transform: this.plugin.buildBulkTransform(payload),
                onConfirm: async (selectedFiles) => {
                    await this.plugin.applyBulkTagOperation(selectedFiles, payload);
                    this.bulkSelectedPaths.clear();
                    this.bulkPostSelection.clear();
                    this.render();
                },
            }).open();
        });

        const results = layout.createDiv({ cls: "tra-bulk-results-card" });
        const resultsHeader = results.createDiv({ cls: "tra-bulk-results-header" });
        const resultsHeading = resultsHeader.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(resultsHeading.createSpan({ cls: "tra-bulk-heading-icon" }), "files");
        resultsHeading.createEl("h3", { text: "Заметки" });
        const resultsActions = resultsHeader.createDiv({ cls: "tra-bulk-results-actions" });
        const sortSelect = resultsActions.createEl("select", { cls: "tra-bulk-input tra-bulk-sort-select", attr: { "aria-label": "Сортировка заметок по дате", title: "Сортировка заметок по дате" } });
        sortSelect.createEl("option", { text: "Сначала новые", attr: { value: "newest" } });
        sortSelect.createEl("option", { text: "Сначала старые", attr: { value: "oldest" } });
        sortSelect.value = this.bulkDateSort;
        sortSelect.addEventListener("change", () => {
            this.bulkDateSort = sortSelect.value;
            if (!this.bulkFilterApplied)
                return;
            this.bulkVisibleFiles = [...this.bulkVisibleFiles].sort((a, b) => this.compareByCreation(a, b));
            const noteList = this.contentEl.querySelector(".tra-bulk-note-list");
            if (!noteList || this.bulkVisibleFiles.length === 0)
                return;
            noteList.scrollTop = 0;
            this.renderBulkNoteCards(noteList, this.bulkVisibleFiles);
        });
        const countBadge = resultsActions.createSpan({ cls: "tra-bulk-results-count", text: "0" });
        this.bulkVisibleFiles = this.bulkFilterApplied ? this.getBulkFilteredFiles() : [];
        const visiblePaths = new Set(this.bulkVisibleFiles.map((file) => file.path));
        for (const selectedPath of this.bulkSelectedPaths) {
            if (!visiblePaths.has(selectedPath))
                this.bulkSelectedPaths.delete(selectedPath);
        }
        // Same controls as on the "Аудит тегов" page.
        const selectionBar = results.createDiv({ cls: "tra-note-selection-bar tra-bulk-selection-bar" });
        const selectAll = selectionBar.createEl("button", { cls: "tra-secondary-button tra-bulk-select-all", attr: { type: "button" } });
        setIcon(selectAll.createSpan({ cls: "tra-button-icon" }), "check-check");
        selectAll.createSpan({ text: "Выбрать все" });
        const selectNone = selectionBar.createEl("button", { cls: "tra-secondary-button tra-bulk-clear-selection", attr: { type: "button" } });
        setIcon(selectNone.createSpan({ cls: "tra-button-icon" }), "circle-x");
        selectNone.createSpan({ text: "Снять все" });
        selectionBar.createSpan({ cls: "tra-note-selection-count tra-bulk-selection-count" });
        selectionBar.createSpan({ cls: "tra-note-selection-hint", text: "Шапка карточки — выбрать заметку, текст — открыть её." });
        selectAll.addEventListener("click", () => {
            for (const file of this.bulkVisibleFiles)
                this.bulkSelectedPaths.add(file.path);
            this.syncBulkSelectionUI();
        });
        selectNone.addEventListener("click", () => {
            this.bulkSelectedPaths.clear();
            this.syncBulkSelectionUI();
        });
        const list = results.createDiv({ cls: "tra-bulk-note-list" });
        if (!this.bulkFilterApplied) {
            list.createDiv({ cls: "tra-bulk-empty tra-bulk-filter-placeholder", text: "Настройте даты и тег (или оставьте «Любые теги») и нажмите «Применить фильтр», чтобы загрузить карточки заметок." });
        }
        else if (this.bulkDateFrom && this.bulkDateTo && this.bulkDateFrom > this.bulkDateTo) {
            list.createDiv({ cls: "tra-bulk-empty", text: "Проверьте диапазон дат: начало позже окончания." });
        }
        else if (this.bulkVisibleFiles.length === 0) {
            const empty = list.createDiv({ cls: "tra-bulk-empty" });
            empty.createDiv({ text: "Нет заметок, подходящих под выбранный период." });
            empty.createDiv({ cls: "tra-bulk-empty-details", text: this.describeDateStats() });
        }
        else {
            this.renderBulkNoteCards(list, this.bulkVisibleFiles);
        }
        countBadge.setText(this.bulkFilterApplied ? String(this.bulkVisibleFiles.length) : "—");
        this.syncBulkSelectionUI();
    }
    parseBulkOperation() {
        const payload = this.parseBulkOperationKind();
        if (!payload)
            return null;
        // Chosen records of the selected notes.
        for (const [path, selection] of this.bulkPostSelection) {
            if (!this.bulkSelectedPaths.has(path))
                continue;
            payload.posts ??= {};
            payload.posts[path] = { indices: [...selection.indices], count: selection.count };
        }
        return payload;
    }
    parseBulkOperationKind() {
        const splitTags = (value) => value.split(/[\s,;]+/).map((item) => normalizeTag(cleanTagInput(item))).filter(Boolean);
        const validate = (tag) => {
            if (!isValidTag(tag)) {
                new Notice(`Некорректное имя тега «${tag}». Допустимы буквы, цифры, _ , - и / для вложенности.`);
                return false;
            }
            return true;
        };
        if (this.bulkAction === "add") {
            const tags = [];
            const seen = new Set();
            for (const tag of splitTags(this.bulkInputs.add)) {
                if (!validate(tag))
                    return null;
                const key = tagKey(tag, this.plugin.settings.caseSensitive);
                if (!seen.has(key)) {
                    seen.add(key);
                    tags.push(tag);
                }
            }
            if (tags.length === 0) {
                new Notice("Укажите хотя бы один тег для добавления.");
                return null;
            }
            return { kind: "add", tags, alwaysYaml: this.bulkAlwaysAddToAttributes };
        }
        if (this.bulkAction === "to-yaml" || this.bulkAction === "to-text") {
            const tags = [];
            for (const tag of splitTags(this.bulkInputs.move ?? "")) {
                if (!validate(tag))
                    return null;
                if (!tags.some((value) => tagKey(value, this.plugin.settings.caseSensitive) === tagKey(tag, this.plugin.settings.caseSensitive)))
                    tags.push(tag);
            }
            return { kind: this.bulkAction, tags };
        }
        if (this.bulkAction === "delete") {
            const tags = [];
            const seen = new Set();
            for (const tag of splitTags(this.bulkInputs.delete)) {
                if (!validate(tag))
                    return null;
                const key = tagKey(tag, this.plugin.settings.caseSensitive);
                if (!seen.has(key)) {
                    seen.add(key);
                    tags.push(tag);
                }
            }
            if (tags.length === 0) {
                new Notice("Укажите хотя бы один тег для удаления.");
                return null;
            }
            return { kind: "delete", changes: tags.map((oldTag) => ({ oldTag, newTag: null, action: "delete" })) };
        }
        const changes = [];
        const seen = new Set();
        const lines = this.bulkInputs.rename.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
            const parts = line.split(/\s*(?:->|→|=>)\s*/);
            if (parts.length !== 2) {
                new Notice(`Не удалось разобрать строку «${line}». Используйте формат: старый-тег -> новый-тег.`);
                return null;
            }
            const oldTag = normalizeTag(cleanTagInput(parts[0]));
            const newTag = normalizeTag(cleanTagInput(parts[1]));
            if (!oldTag || !newTag || !validate(oldTag) || !validate(newTag))
                return null;
            if (tagKey(oldTag, this.plugin.settings.caseSensitive) === tagKey(newTag, this.plugin.settings.caseSensitive)) {
                new Notice(`Старый и новый теги совпадают: #${oldTag}.`);
                return null;
            }
            const key = tagKey(oldTag, this.plugin.settings.caseSensitive);
            if (seen.has(key)) {
                new Notice(`Тег #${oldTag} указан для переименования несколько раз.`);
                return null;
            }
            seen.add(key);
            changes.push({ oldTag, newTag, action: "rename" });
        }
        if (changes.length === 0) {
            new Notice("Укажите пары тегов в формате старый-тег -> новый-тег.");
            return null;
        }
        return { kind: "rename", changes };
    }
    /**
     * Cards are added in pages and their Markdown previews are rendered only
     * when scrolled into view, so filtering thousands of notes stays fast.
     * Selection works on the full filtered list, not only on rendered cards.
     */
    renderBulkNoteCards(parent, files) {
        parent.empty();
        const limit = Math.min(files.length, Math.max(BULK_PAGE_SIZE, this.bulkRenderLimit));
        this.appendBulkNoteCards(parent, files, 0, limit);
    }
    appendBulkNoteCards(parent, files, from, to) {
        for (const file of files.slice(from, to)) {
            const selected = this.bulkSelectedPaths.has(file.path);
            const card = parent.createDiv({
                cls: `tra-bulk-note-card${selected ? " is-selected" : ""}`,
                attr: { tabindex: "0", "aria-label": `Заметка ${file.basename}: Enter — открыть, пробел — выбрать`, "data-path": file.path },
            });
            const header = card.createDiv({ cls: "tra-bulk-note-header", attr: { title: "Выбрать или снять выбор" } });
            const checkbox = header.createEl("input", { cls: "tra-file-check tra-bulk-check", attr: { type: "checkbox", title: "Изменять эту заметку", "aria-label": `Изменять заметку ${file.basename}` } });
            checkbox.checked = selected;
            checkbox.addEventListener("click", (event) => event.stopPropagation());
            checkbox.addEventListener("change", () => {
                if (checkbox.checked !== this.bulkSelectedPaths.has(file.path))
                    this.toggleBulkFile(file.path);
            });
            const title = header.createDiv({ cls: "tra-bulk-note-title" });
            title.createEl("strong", { text: file.basename });
            title.createDiv({ cls: "tra-bulk-note-path", text: file.path });
            const created = this.getNoteCreationTimestamp(file);
            title.createDiv({ cls: "tra-bulk-note-date", text: created ? new Date(created).toLocaleDateString() : "Без даты" });
            title.createSpan({ cls: "tra-post-badge" });
            const openPreview = () => new NotePreviewModal(this.plugin.app, file, {
                plugin: this.plugin,
                selection: {
                    isSelected: () => this.bulkSelectedPaths.has(file.path),
                    toggle: () => this.toggleBulkFile(file.path),
                },
                posts: {
                    get: () => this.bulkPostSelection.get(file.path) ?? null,
                    set: (value) => {
                        if (value)
                            this.bulkPostSelection.set(file.path, value);
                        else
                            this.bulkPostSelection.delete(file.path);
                        this.syncBulkSelectionUI();
                    },
                },
            }).open();
            // Two click zones: the header (title, path, date) toggles the
            // checkbox, the text and tags open the note in a window.
            card.addEventListener("click", (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (target?.closest("a.external-link, .tra-file-check"))
                    return;
                if (target?.closest(".tra-bulk-note-header"))
                    this.toggleBulkFile(file.path);
                else
                    openPreview();
            });
            card.addEventListener("keydown", (event) => {
                if (event.target !== card)
                    return;
                if (event.key === "Enter") {
                    event.preventDefault();
                    openPreview();
                }
                else if (event.key === " ") {
                    event.preventDefault();
                    this.toggleBulkFile(file.path);
                }
            });
            const excerpt = card.createDiv({ cls: "tra-bulk-note-excerpt markdown-rendered", text: "Загрузка предпросмотра…", attr: { title: "Открыть заметку" } });
            const tagsFooter = card.createDiv({ cls: "tra-bulk-note-footer" });
            const tagsLabel = tagsFooter.createSpan({ cls: "tra-bulk-tags-label", text: "Теги" });
            const tags = this.getTagsForFile(file);
            const tagsWrap = tagsFooter.createDiv({ cls: "tra-bulk-note-tags" });
            if (tags.length === 0) {
                tagsWrap.createSpan({ cls: "tra-bulk-no-tags", text: "Нет тегов" });
            }
            else {
                for (const tag of tags) {
                    const chip = tagsWrap.createSpan({ cls: "tra-bulk-tag-chip" });
                    chip.createSpan({ cls: "tra-tag-hash", text: "#" });
                    chip.createSpan({ text: tag });
                }
            }
            this.renderWhenVisible(excerpt, () => this.renderBulkExcerpt(excerpt, file));
        }
        if (to < files.length) {
            const more = parent.createEl("button", {
                cls: "tra-show-more tra-bulk-show-more",
                text: `Показать ещё ${Math.min(BULK_PAGE_SIZE, files.length - to)} из ${files.length - to}`,
                attr: { type: "button" },
            });
            more.addEventListener("click", () => {
                more.remove();
                const next = Math.min(files.length, to + BULK_PAGE_SIZE);
                this.bulkRenderLimit = next;
                this.appendBulkNoteCards(parent, files, to, next);
                this.syncBulkSelectionUI();
            });
        }
    }
    async renderBulkExcerpt(parent, file) {
        const component = this.renderComponent;
        try {
            const raw = await this.plugin.app.vault.cachedRead(file);
            if (!parent.isConnected || component !== this.renderComponent)
                return;
            const body = stripFrontmatter(raw).trim();
            const maxChars = Math.min(320, this.plugin.settings.previewChars || 320);
            let excerpt = body.slice(0, maxChars);
            if (body.length > maxChars)
                excerpt = `${excerpt.trimEnd()}…`;
            parent.empty();
            if (!excerpt) {
                parent.createDiv({ cls: "tra-bulk-excerpt-empty", text: "Пустая заметка" });
                return;
            }
            await MarkdownRenderer.render(this.plugin.app, excerpt, parent, file.path, component);
        }
        catch {
            if (parent.isConnected)
                parent.setText("Не удалось загрузить предпросмотр заметки.");
        }
    }
    toggleBulkFile(path) {
        if (this.bulkSelectedPaths.has(path))
            this.bulkSelectedPaths.delete(path);
        else
            this.bulkSelectedPaths.add(path);
        this.syncBulkSelectionUI();
    }
    syncBulkSelectionUI() {
        const root = this.contentEl;
        const count = this.bulkSelectedPaths.size;
        const total = this.bulkVisibleFiles.length;
        const countEl = root.querySelector(".tra-bulk-selected-count");
        if (countEl)
            countEl.textContent = `Выбрано ${count} ${pluralRu(count, "заметка", "заметки", "заметок")}`;
        const barCount = root.querySelector(".tra-bulk-selection-count");
        if (barCount)
            barCount.textContent = this.bulkFilterApplied ? `Выбрано ${count} из ${total}` : "Сначала примените фильтр";
        const selectAllButton = root.querySelector(".tra-bulk-select-all");
        if (selectAllButton)
            selectAllButton.disabled = total === 0 || count === total;
        const clearButton = root.querySelector(".tra-bulk-clear-selection");
        if (clearButton)
            clearButton.disabled = count === 0;
        const applyButton = root.querySelector(".tra-bulk-apply");
        if (applyButton)
            applyButton.disabled = count === 0;
        for (const card of Array.from(root.querySelectorAll(".tra-bulk-note-card"))) {
            const path = card.getAttribute("data-path");
            const isSelected = Boolean(path && this.bulkSelectedPaths.has(path));
            card.classList.toggle("is-selected", isSelected);
            updatePostBadge(card, isSelected ? this.bulkPostSelection.get(path) : null);
            const checkbox = card.querySelector(".tra-bulk-check");
            if (checkbox)
                checkbox.checked = isSelected;
        }
    }
    fillDateSourceOptions(select) {
        const settings = this.plugin.settings;
        const property = (settings.createdDateProperty ?? "").trim();
        select.createEl("option", { text: "Дата создания файла", attr: { value: "ctime" } });
        select.createEl("option", { text: "Дата изменения файла", attr: { value: "mtime" } });
        const candidates = this.plugin.getDateFieldCandidates();
        if (property && !candidates.some((item) => item.key === property))
            candidates.unshift({ key: property, count: null });
        if (candidates.length > 0) {
            const group = select.createEl("optgroup", { attr: { label: "Свойство YAML" } });
            for (const item of candidates)
                group.createEl("option", { text: item.count === null ? item.key : `${item.key} (${item.count})`, attr: { value: item.key } });
        }
        select.value = property || (settings.fileDateField === "mtime" ? "mtime" : "ctime");
    }
    /** Date coverage of the current source: how many notes have a date and their range. */
    getDateStats() {
        const isIgnored = makeIgnoredPathMatcher(this.plugin.settings.ignoredFolders ?? []);
        let total = 0;
        let dated = 0;
        let min = Infinity;
        let max = -Infinity;
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            if (isIgnored(file.path))
                continue;
            total += 1;
            const time = this.getNoteCreationTimestamp(file);
            if (!time)
                continue;
            dated += 1;
            min = Math.min(min, time);
            max = Math.max(max, time);
        }
        return { total, dated, min, max };
    }
    describeDateStats() {
        const { total, dated, min, max } = this.getDateStats();
        const source = this.plugin.describeDateSource();
        if (dated === 0)
            return `Источник: ${source}. Ни у одной из ${total} заметок нет даты в этом источнике — выберите другой источник даты.`;
        const range = `с ${new Date(min).toLocaleDateString()} по ${new Date(max).toLocaleDateString()}`;
        return `Источник: ${source}. Дата есть у ${dated} из ${total} заметок, ${range}.`;
    }
    renderDateStats(el) {
        el.empty();
        el.createDiv({ text: this.describeDateStats() });
        const property = (this.plugin.settings.createdDateProperty ?? "").trim();
        const candidates = this.plugin.getDateFieldCandidates();
        if (!property && this.plugin.settings.fileDateField !== "mtime" && candidates.length > 0) {
            el.createDiv({
                cls: "tra-bulk-hint-warning",
                text: `Дату создания файла часто сбрасывают синхронизация и копирование. В заметках найдено свойство с датами «${candidates[0].key}» — его можно выбрать выше.`,
            });
        }
    }
}

module.exports = { BulkPageMixin };
};

/* ===== src/view/tag-auditor-view.js ===== */
EMBEDDED_MODULES["view/tag-auditor-view.js"] = function (module, exports, require) {
"use strict";
/** Экран плагина: жизненный цикл, общая шапка, перерисовка и ленивые предпросмотры. */
const { Component, ItemView, Notice, Platform, setIcon } = require("obsidian");
const { BULK_PAGE_SIZE, VIEW_TYPE } = require("../constants.js");
const { applyMixins, relativeTime } = require("../utils.js");
const { AuditPageMixin } = require("./audit-page.js");
const { BulkPageMixin } = require("./bulk-page.js");

class TagAuditorView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.selectedTag = null;
        this.query = "";
        this.showAllPreviews = false;
        this.tagListScrollTop = 0;
        this.sortMode = "name";
        this.activePage = "audit";
        this.bulkDateFrom = "";
        this.bulkDateTo = "";
        // Filters of the "Заметки по датам" page.
        this.bulkFolder = "";
        this.bulkTagMode = "any";
        this.bulkIncludeTags = [];
        this.bulkExcludeTags = [];
        this.bulkTextQuery = "";
        this.bulkTextMatches = null;
        // Chosen records inside notes: path -> { indices: number[], count }.
        this.bulkPostSelection = new Map();
        this.postSelection = new Map();
        this.bulkFilterApplied = false;
        this.bulkDateSort = "newest";
        this.bulkAlwaysAddToAttributes = false;
        this.bulkAction = "add";
        this.bulkInputs = { add: "", rename: "", delete: "", move: "" };
        this.bulkSelectedPaths = new Set();
        this.bulkVisibleFiles = [];
        this.bulkRenderLimit = BULK_PAGE_SIZE;
        this.renameDraft = { tag: null, value: "", addTags: "" };
        this.renderComponent = null;
        this.renderGeneration = 0;
        this.lazyObserver = null;
        this.lazyLoaders = null;
        this.needsRender = false;
        this.plugin = plugin;
    }
    getViewType() {
        return VIEW_TYPE;
    }
    getDisplayText() {
        return "Tag Refactor & Auditor";
    }
    getIcon() {
        return "tags";
    }
    async onOpen() {
        // Index updates that arrive while this tab is hidden are applied when it
        // becomes visible again instead of rebuilding an invisible DOM.
        this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.flushPendingRender()));
        this.registerEvent(this.app.workspace.on("layout-change", () => this.flushPendingRender()));
        await this.plugin.ensureFreshIndex();
        this.render();
    }
    async onClose() {
        this.disposeRenderResources();
        this.contentEl.empty();
    }
    isVisible() {
        const el = this.containerEl;
        return typeof el.isShown === "function" ? el.isShown() : el.isConnected;
    }
    /** Re-render on index changes, deferring the work while the tab is hidden. */
    requestRender() {
        if (this.isVisible()) {
            this.needsRender = false;
            this.render();
        }
        else {
            this.needsRender = true;
        }
    }
    flushPendingRender() {
        if (this.needsRender && this.isVisible()) {
            this.needsRender = false;
            this.render();
        }
    }
    /**
     * Markdown previews register child components (embeds, plugin code blocks)
     * on the component passed to MarkdownRenderer. Using a fresh child per
     * render and unloading it here keeps them from piling up on the view.
     */
    disposeRenderResources() {
        this.lazyObserver?.disconnect();
        this.lazyObserver = null;
        this.catalog?.observer?.disconnect();
        this.catalog = null;
        if (this.renderComponent) {
            this.removeChild(this.renderComponent);
            this.renderComponent = null;
        }
    }
    /** Render `loader` only when `el` scrolls near the viewport. */
    renderWhenVisible(el, loader) {
        if (typeof IntersectionObserver === "undefined") {
            void loader();
            return;
        }
        if (!this.lazyObserver) {
            const loaders = new WeakMap();
            const observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting)
                        continue;
                    observer.unobserve(entry.target);
                    const load = loaders.get(entry.target);
                    loaders.delete(entry.target);
                    if (load)
                        void load();
                }
            }, { rootMargin: "300px 0px" });
            this.lazyObserver = observer;
            this.lazyLoaders = loaders;
        }
        this.lazyLoaders.set(el, loader);
        this.lazyObserver.observe(el);
    }
    captureUiState(root) {
        const active = document.activeElement;
        let focus = null;
        if (active instanceof HTMLElement && root.contains(active) && active.dataset.traField) {
            focus = { field: active.dataset.traField, start: null, end: null };
            try {
                focus.start = active.selectionStart ?? null;
                focus.end = active.selectionEnd ?? null;
            }
            catch {
                // Number and date inputs do not expose a selection.
            }
        }
        return {
            focus,
            rootScrollTop: root.scrollTop,
            bulkListScrollTop: root.querySelector(".tra-bulk-note-list")?.scrollTop ?? 0,
        };
    }
    restoreUiState(root, state) {
        const apply = () => {
            if (!root.isConnected)
                return;
            root.scrollTop = state.rootScrollTop;
            const bulkList = root.querySelector(".tra-bulk-note-list");
            if (bulkList)
                bulkList.scrollTop = state.bulkListScrollTop;
        };
        apply();
        window.requestAnimationFrame(apply);
        if (!state.focus)
            return;
        const field = root.querySelector(`[data-tra-field="${state.focus.field}"]`);
        if (!(field instanceof HTMLElement))
            return;
        field.focus({ preventScroll: true });
        if (state.focus.start !== null && typeof field.setSelectionRange === "function") {
            try {
                field.setSelectionRange(state.focus.start, state.focus.end ?? state.focus.start);
            }
            catch {
                // Ignore inputs without text selection support.
            }
        }
    }
    render() {
        const root = this.contentEl;
        // Keep the tag catalog at its current scroll position when selecting a tag
        // causes the whole view to be rebuilt.
        const previousTagList = root.querySelector(".tra-tag-list");
        const previousTagListScrollTop = previousTagList?.scrollTop ?? this.tagListScrollTop ?? 0;
        this.tagListScrollTop = previousTagListScrollTop;
        const uiState = this.captureUiState(root);
        this.disposeRenderResources();
        this.renderGeneration += 1;
        this.renderComponent = this.addChild(new Component());
        root.empty();
        root.addClass("tra-view");
        // Touch layout on phones and tablets (larger hit areas, full-screen windows).
        root.classList.toggle("is-tra-mobile", Boolean(Platform?.isMobile));
        const shell = root.createDiv({ cls: "tra-shell" });

        const header = shell.createDiv({ cls: "tra-header" });
        const titleGroup = header.createDiv({ cls: "tra-title-group" });
        const iconWrap = titleGroup.createDiv({ cls: "tra-title-icon" });
        setIcon(iconWrap, "tags");
        const heading = titleGroup.createDiv({ cls: "tra-heading" });
        heading.createEl("h2", { text: "Tag Refactor" });
        heading.createEl("p", { text: "Аудит, рефакторинг и массовое управление тегами" });
        const scanButton = header.createEl("button", { cls: "tra-icon-button", attr: { "aria-label": "Сканировать теги", title: "Сканировать теги" } });
        setIcon(scanButton, "refresh-cw");
        scanButton.addEventListener("click", () => {
            void this.plugin.scanTags({ force: true }).then(() => new Notice("Сканирование тегов завершено."));
        });

        const overview = shell.createDiv({ cls: "tra-overview" });
        this.createStat(overview, "Теги", String(this.plugin.tagIndex.size), "hash");
        this.createStat(overview, "Заметки", String(this.plugin.app.vault.getMarkdownFiles().length), "files");
        this.createStat(overview, "В очереди", String(this.plugin.getPendingChanges().length), "git-pull-request");

        const pageTabs = shell.createDiv({ cls: "tra-page-tabs", attr: { role: "tablist", "aria-label": "Разделы Tag Refactor" } });
        const auditTab = pageTabs.createEl("button", {
            cls: `tra-page-tab${this.activePage === "audit" ? " is-active" : ""}`,
            attr: { type: "button", role: "tab", "aria-selected": String(this.activePage === "audit") },
        });
        setIcon(auditTab.createSpan({ cls: "tra-page-tab-icon" }), "tags");
        auditTab.createSpan({ text: "Аудит тегов" });
        auditTab.addEventListener("click", () => {
            if (this.activePage !== "audit") {
                this.activePage = "audit";
                this.render();
            }
        });
        const bulkTab = pageTabs.createEl("button", {
            cls: `tra-page-tab${this.activePage === "bulk" ? " is-active" : ""}`,
            attr: { type: "button", role: "tab", "aria-selected": String(this.activePage === "bulk") },
        });
        setIcon(bulkTab.createSpan({ cls: "tra-page-tab-icon" }), "list-checks");
        bulkTab.createSpan({ text: "Заметки по датам" });
        bulkTab.addEventListener("click", () => {
            if (this.activePage !== "bulk") {
                this.activePage = "bulk";
                this.render();
            }
        });

        if (this.activePage === "bulk")
            this.renderBulkManagement(shell);
        else
            this.renderAuditPage(shell, previousTagListScrollTop);
        this.renderFooter(shell);
        this.restoreUiState(root, uiState);
    }
    renderFooter(shell) {
        const footer = shell.createDiv({ cls: "tra-footer" });
        footer.createSpan({ text: this.plugin.lastScanTime ? `Синхронизировано · ${relativeTime(this.plugin.lastScanTime)}` : "Ожидание индекса" });
        const settingsButton = footer.createEl("button", { cls: "tra-text-button", text: "Настройки" });
        settingsButton.addEventListener("click", () => {
            // Obsidian exposes settings navigation at runtime.
            this.plugin.app.setting?.open();
            this.plugin.app.setting?.openTabById?.(this.plugin.manifest.id);
        });
    }
    getTagsForFile(file) {
        // Precomputed per scan; already in catalog (collator) order.
        return this.plugin.getTagsForFile(file);
    }
    createStat(parent, label, value, iconName) {
        const stat = parent.createDiv({ cls: "tra-stat" });
        const icon = stat.createDiv({ cls: "tra-stat-icon" });
        setIcon(icon, iconName);
        stat.createDiv({ cls: "tra-stat-label", text: label });
        stat.createDiv({ cls: "tra-stat-value", text: value });
    }
    getNoteCreationTimestamp(file) {
        return this.plugin.getNoteCreationTimestamp(file);
    }
}
applyMixins(TagAuditorView, AuditPageMixin, BulkPageMixin);

module.exports = { TagAuditorView };
};
