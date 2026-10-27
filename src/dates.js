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
