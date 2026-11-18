"use strict";
/** Аккуратное разделение дневниковых записей по строкам времени. */
const { Notice, setIcon } = require("obsidian");
const { pluralRu } = require("../utils.js");

class ExtractPageMixin {
    renderExtractManagement(shell) {
        const intro = shell.createDiv({ cls: "tra-bulk-intro" });
        intro.createEl("h3", { text: "Разделение записей" });
        intro.createEl("p", { text: "Ищет строки со временем и выносит записи после первой в отдельные файлы. Первая запись, даже если она начинается со времени, остаётся в оригинале." });

        const layout = shell.createDiv({ cls: "tra-bulk-layout tra-extract-layout" });
        const controls = layout.createDiv({ cls: "tra-bulk-controls-card" });
        const heading = controls.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(heading.createSpan({ cls: "tra-bulk-heading-icon" }), "scissors");
        heading.createEl("h3", { text: "Параметры обработки" });

        const folderGroup = controls.createDiv({ cls: "tra-bulk-form-group" });
        folderGroup.createEl("label", { text: "Папка для обработки" });
        const folder = folderGroup.createEl("input", { cls: "tra-bulk-input", attr: { type: "text", list: "tra-extract-folder-options", placeholder: "Начните вводить путь к папке…", autocomplete: "off", spellcheck: "false", "aria-label": "Папка для обработки" } });
        folder.value = this.extractFolder ?? "";
        const folderOptions = folderGroup.createEl("datalist", { attr: { id: "tra-extract-folder-options" } });
        for (const name of this.getVaultFolders()) folderOptions.createEl("option", { attr: { value: name } });

        const quarantineGroup = controls.createDiv({ cls: "tra-bulk-form-group" });
        quarantineGroup.createEl("label", { text: "Папка резервных копий" });
        const quarantine = quarantineGroup.createEl("input", { cls: "tra-bulk-input", attr: { type: "text", value: this.extractQuarantine || "quarantine" } });
        const hint = controls.createDiv({ cls: "tra-bulk-hint" });
        hint.setText("Копия исходника сохраняется в quarantine с сохранением структуры подпапок. Извлечённые файлы создаются рядом с оригиналом. Повторные имена получают суффикс -01, -02 и т. д.");

        const result = layout.createDiv({ cls: "tra-bulk-results-card" });
        const resultHead = result.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(resultHead.createSpan({ cls: "tra-bulk-heading-icon" }), "files");
        resultHead.createEl("h3", { text: "Предварительная проверка" });
        const summary = result.createDiv({ cls: "tra-bulk-hint", text: "Выберите папку и выполните проверку. Файлы не изменяются до подтверждения запуска." });
        const list = result.createDiv({ cls: "tra-attributes-file-list tra-extract-file-list" });
        const scan = result.createEl("button", { cls: "tra-secondary-button", text: "Проверить папку" });
        const run = result.createEl("button", { cls: "tra-primary-button tra-attributes-apply", text: "Разделить выбранные заметки" });
        run.disabled = true;
        let candidates = [];

        const resetScan = () => { this.extractFolder = folder.value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); candidates = []; list.empty(); summary.setText("Нажмите «Проверить папку» для предварительного просмотра."); run.disabled = true; };
        folder.addEventListener("input", resetScan);
        folder.addEventListener("change", resetScan);
        scan.addEventListener("click", async () => {
            const selectedFolder = folder.value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            if (!selectedFolder) { new Notice("Укажите папку."); return; }
            if (!this.getVaultFolders().includes(selectedFolder)) { new Notice("Такой папки нет в хранилище. Выберите существующую папку из подсказок."); return; }
            this.extractFolder = selectedFolder;
            scan.disabled = true; run.disabled = true; list.empty();
            try {
                const files = this.plugin.app.vault.getMarkdownFiles().filter(f => f.parent?.path === selectedFolder || f.path.startsWith(`${selectedFolder}/`)).sort((a,b)=>a.path.localeCompare(b.path));
                candidates = [];
                let skipped = 0;
                for (const file of files) {
                    const content = await this.plugin.app.vault.read(file);
                    const parsed = this.inspectExtractableNote(file, content);
                    if (parsed) candidates.push({ file, content, parsed });
                    else skipped++;
                }
                summary.setText(`Найдено для разделения: ${candidates.length}. Пропущено (уже отдельные или нет подходящих записей): ${skipped}.`);
                if (!candidates.length) list.createDiv({ cls: "tra-bulk-empty", text: "В этой папке нет заметок, которые можно безопасно разделить." });
                for (const item of candidates) {
                    const row = list.createDiv({ cls: "tra-attributes-file-row" });
                    const info = row.createDiv({ cls: "tra-attributes-file-info" });
                    info.createDiv({ cls: "tra-attributes-file-name", text: item.file.basename });
                    info.createDiv({ cls: "tra-attributes-file-path", text: `${item.parsed.parts.length} записей → ${item.parsed.parts.length - 1} новых файла` });
                    info.createDiv({ cls: "tra-attributes-file-date", text: `Новые времена: ${item.parsed.parts.slice(1).map(p=>p.time).join(", ")}` });
                    if (item.parsed.specialDateHeadings?.length) info.createDiv({ cls: "tra-attributes-file-date", text: `Заголовки дат для подтверждения: ${item.parsed.specialDateHeadings.length}` });
                }
                run.disabled = candidates.length === 0;
            } catch (error) { console.error("Tag Refactor: extract scan failed", error); new Notice(`Ошибка проверки: ${error.message}`); }
            finally { scan.disabled = false; }
        });

        run.addEventListener("click", async () => {
            if (!candidates.length) return;
            this.extractQuarantine = quarantine.value.trim().replace(/^\/+|\/+$/g, "") || "quarantine";
            const app = this.plugin.app;
            const count = candidates.reduce((n, x) => n + x.parsed.parts.length - 1, 0);
            const confirmed = await new Promise(resolve => {
                const { Modal } = require("obsidian");
                const modal = new Modal(app);
                modal.titleEl.setText("Подтвердите разделение");
                modal.contentEl.createEl("p", { text: `Будет обработано ${candidates.length} исходных заметок и создано ${count} отдельных файлов. Перед изменением каждый оригинал будет скопирован в «${this.extractQuarantine}». Продолжить?` });
                const actions = modal.contentEl.createDiv({ cls: "modal-button-container" });
                const cancel = actions.createEl("button", { text: "Отмена" });
                cancel.addEventListener("click", () => { modal.close(); resolve(false); });
                const yes = actions.createEl("button", { text: "Создать копии и разделить", cls: "mod-cta" });
                yes.addEventListener("click", () => { modal.close(); resolve(true); });
                modal.open();
            });
            if (!confirmed) return;
            run.disabled = true; scan.disabled = true;
            let originals = 0, extracted = 0, errors = 0;
            try {
                for (const item of candidates) {
                    try {
                        let skipItem = false;
                        for (const heading of (item.parsed.specialDateHeadings ?? [])) {
                            const decision = await this.askSpecialDateDecision(item, heading);
                            if (decision === "skip") { skipItem = true; break; }
                            if (decision === "none") { skipItem = true; break; }
                            const part = item.parsed.parts[heading.markerIndex];
                            if (part) {
                                const selectedTimestamp = decision === "heading" ? heading.headingTimestamp : heading.defaultTimestamp;
                                part.timestamp = selectedTimestamp;
                                part.content = this.addExtractedDate(part.content, selectedTimestamp);
                            }
                        }
                        if (skipItem) continue;
                        const backupPath = `${this.extractQuarantine}/${item.file.path}`;
                        await this.ensureVaultFolder(backupPath.split("/").slice(0,-1).join("/"));
                        if (!(await app.vault.adapter.exists(backupPath))) await app.vault.create(backupPath, item.content);
                        else {
                            const ext = ".md";
                            let i = 1, candidate;
                            do { candidate = backupPath.slice(0,-ext.length) + `-${String(i).padStart(2,"0")}${ext}`; i++; } while (await app.vault.adapter.exists(candidate));
                            await app.vault.create(candidate, item.content);
                        }
                        for (const part of item.parsed.parts.slice(1)) {
                            const path = await this.uniqueExtractPath(item.file.parent?.path ?? "", part.timestamp);
                            await app.vault.create(path, part.content);
                            extracted++;
                        }
                        await app.vault.modify(item.file, item.parsed.original);
                        originals++;
                    } catch (error) { errors++; console.error("Tag Refactor: failed to split", item.file.path, error); }
                }
                new Notice(`Разделение завершено. Оригиналов: ${originals}, новых заметок: ${extracted}, ошибок: ${errors}.`, 10000);
                candidates = [];
                summary.setText("Обработка завершена. Выполните проверку папки повторно, если нужно.");
                list.empty(); run.disabled = true;
            } finally { scan.disabled = false; }
        });
    }

    inspectExtractableNote(file, content) {
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split(/\r?\n/);
        let bodyStart = 0;
        if (lines[0]?.trim() === "---") {
            const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
            if (end >= 0) bodyStart = end + 1;
        }
        while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
        const firstBodyLine = lines[bodyStart] ?? "";
        // The first timestamp marks the entry that stays in the original.
        // Do not skip the whole file just because its first entry starts with a time:
        // long diary notes can start with their own timestamp and contain many later entries.

        const markers = [];
        for (let i = bodyStart; i < lines.length; i++) {
            const match = lines[i].match(/^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
            if (!match) continue;
            const h = Number(match[1]), m = Number(match[2]), s = Number(match[3] ?? 0);
            if (h > 23 || m > 59 || s > 59) continue;
            markers.push({ line: i, time: `${String(h).padStart(2,"0")}:${match[2]}${match[3] ? `:${match[3]}` : ""}`, h, m, s });
        }
        if (markers.length < 2) return null;
        const base = file.basename.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!base) return null;
        const year = Number(base[1]), month = Number(base[2]), day = Number(base[3]);
        const check = new Date(year, month-1, day);
        if (check.getFullYear() !== year || check.getMonth() !== month-1 || check.getDate() !== day) return null;

        const offsets = [];
        let offset = 0;
        for (let i = 0; i < lines.length; i++) { offsets.push(offset); offset += lines[i].length + (i < lines.length-1 ? newline.length : 0); }
        const parts = [];
        const specialDateHeadings = [];
        let activeDate = new Date(year, month - 1, day);
        let previousSeconds = null;
        const russianMonths = {
            "января": 0, "февраля": 1, "марта": 2, "апреля": 3,
            "мая": 4, "июня": 5, "июля": 6, "августа": 7,
            "сентября": 8, "октября": 9, "ноября": 10, "декабря": 11,
        };
        const markerByLine = new Map(markers.map((marker) => [marker.line, marker]));
        for (let lineIndex = bodyStart; lineIndex < lines.length; lineIndex++) {
            const dayHeading = lines[lineIndex].match(/^\s*(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})(?:\s+года)?(?:\s*[,—-].*)?\s*$/i)
                || lines[lineIndex].match(/^\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\s*[,—-].*)?\s*$/);
            if (dayHeading) {
                let headingDay, headingMonth, headingYear;
                if (/январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр/i.test(dayHeading[2])) {
                    headingDay = Number(dayHeading[1]);
                    headingMonth = russianMonths[dayHeading[2].toLowerCase()];
                    headingYear = Number(dayHeading[3]);
                } else {
                    headingDay = Number(dayHeading[1]);
                    headingMonth = Number(dayHeading[2]) - 1;
                    headingYear = Number(dayHeading[3]);
                }
                const headingDate = new Date(headingYear, headingMonth, headingDay);
                const valid = headingDate.getFullYear() === headingYear && headingDate.getMonth() === headingMonth && headingDate.getDate() === headingDay;
                let nextLine = lineIndex + 1;
                while (nextLine < lines.length && !lines[nextLine].trim()) nextLine++;
                const headingTime = lines[nextLine]?.match(/^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
                if (headingTime && headingDate.getFullYear() >= 1000 && headingDate.getFullYear() <= 9999) {
                    const h = Number(headingTime[1]), m = Number(headingTime[2]), sec = Number(headingTime[3] ?? 0);
                    if (h <= 23 && m <= 59 && sec <= 59) {
                        const timeMarker = markerByLine.get(nextLine);
                        if (timeMarker) {
                            const markerIndex = markers.indexOf(timeMarker);
                            const defaultTimestamp = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate(), h, m, sec).getTime();
                            const headingTimestamp = new Date(headingDate.getFullYear(), headingDate.getMonth(), headingDate.getDate(), h, m, sec).getTime();
                            // The first date heading usually repeats the date already encoded in the filename.
                            // Ask only when the heading proposes a different calendar date.
                            const differs = headingDate.getFullYear() !== activeDate.getFullYear() || headingDate.getMonth() !== activeDate.getMonth() || headingDate.getDate() !== activeDate.getDate();
                            if (differs) {
                                const formatDate = (date) => `${String(date.getDate()).padStart(2,"0")} ${["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"][date.getMonth()]} ${date.getFullYear()}, ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
                                specialDateHeadings.push({ markerIndex, line: lineIndex, raw: lines[lineIndex].trim(), defaultTimestamp, headingTimestamp, defaultLabel: formatDate(activeDate), headingLabel: formatDate(headingDate), valid });
                            }
                        }
                    }
                }
                if (valid) { activeDate = headingDate; previousSeconds = null; }
            }
            const marker = markerByLine.get(lineIndex);
            if (!marker) continue;
            const secondsOfDay = marker.h * 3600 + marker.m * 60 + marker.s;
            // When there is no explicit day heading, a clock reset means midnight passed.
            if (previousSeconds !== null && secondsOfDay < previousSeconds) {
                activeDate = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate() + 1);
            }
            previousSeconds = secondsOfDay;
            const timestamp = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate(), marker.h, marker.m, marker.s).getTime();
            const markerIndex = markers.indexOf(marker);
            const specialHeading = specialDateHeadings.find((heading) => heading.markerIndex === markerIndex);
            const start = offsets[specialHeading ? specialHeading.line : marker.line];
            const end = markerIndex + 1 < markers.length ? offsets[markers[markerIndex + 1].line] : content.length;
            const segment = content.slice(start, end).replace(/^\s+|\s+$/g, "") + newline;
            parts.push({ time: marker.time, timestamp, content: this.addExtractedDate(segment, timestamp), startOffset: start });
        }
        // Keep all material before the second timestamp, including YAML and any introductory text, in the original.
        const splitAt = parts[1]?.startOffset ?? offsets[markers[1].line];
        const original = content.slice(0, splitAt).replace(/\s+$/, "") + newline;
        return { original, parts, specialDateHeadings };
    }

    async askSpecialDateDecision(item, heading) {
        const { Modal } = require("obsidian");
        return await new Promise(resolve => {
            const modal = new Modal(this.plugin.app);
            modal.titleEl.setText("Неоднозначная дата в заметке");
            modal.contentEl.createEl("p", { text: item.file.path });
            modal.contentEl.createEl("blockquote", { text: heading.raw });
            modal.contentEl.createEl("p", { text: `Дата из исходной заметки для новой записи: ${heading.defaultLabel}` });
            modal.contentEl.createEl("p", { text: `Дата из заголовка для новой записи: ${heading.headingLabel}` });
            modal.contentEl.createEl("p", { text: "Выберите дату только для извлекаемой записи. Дата и YAML исходной заметки не изменяются. «Ничего не делать» отменит обработку этого исходного файла." });
            const actions = modal.contentEl.createDiv({ cls: "modal-button-container" });
            const choose = (value) => { modal.close(); resolve(value); };
            const fromContext = actions.createEl("button", { text: `Использовать ${heading.defaultLabel}` });
            fromContext.addEventListener("click", () => choose("context"));
            const fromHeading = actions.createEl("button", { text: `Использовать ${heading.headingLabel}`, cls: "mod-cta" });
            fromHeading.addEventListener("click", () => choose("heading"));
            const none = actions.createEl("button", { text: "Ничего не делать" });
            none.addEventListener("click", () => choose("none"));
            modal.open();
        });
    }

    addExtractedDate(content, timestamp) {
        const date = new Date(timestamp);
        const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
        const value = `${String(date.getDate()).padStart(2, "0")} ${months[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split(/\r?\n/);
        if (lines[0]?.trim() === "---") {
            const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
            if (end >= 0) {
                const frontmatter = lines.slice(1, end).filter((line) => !/^Дата\s*:/.test(line));
                lines.splice(1, end - 1, `Дата: ${value}`, ...frontmatter);
                return lines.join(newline);
            }
        }
        return `---${newline}Дата: ${value}${newline}---${newline}${content}`;
    }

    async ensureVaultFolder(path) {
        if (!path || path === "/") return;
        const app = this.plugin.app;
        if (await app.vault.adapter.exists(path)) return;
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (parent) await this.ensureVaultFolder(parent);
        try { await app.vault.createFolder(path); } catch (error) { if (!(await app.vault.adapter.exists(path))) throw error; }
    }

    async uniqueExtractPath(folder, timestamp) {
        if (!Number.isFinite(timestamp)) throw new Error("Некорректная дата извлекаемой записи: timestamp не является числом.");
        const d = new Date(timestamp);
        if (Number.isNaN(d.getTime())) throw new Error("Некорректная дата извлекаемой записи.");
        const base = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}-${String(d.getMinutes()).padStart(2,"0")}-${String(d.getSeconds()).padStart(2,"0")}`;
        const stem = `${folder ? `${folder}/` : ""}${base}`;
        let path = `${stem}_extracted.md`;
        if (!(await this.plugin.app.vault.adapter.exists(path))) return path;
        for (let i = 1; i < 10000; i++) {
            path = `${stem}-${String(i).padStart(2,"0")}_extracted.md`;
            if (!(await this.plugin.app.vault.adapter.exists(path))) return path;
        }
        throw new Error(`Не удалось подобрать свободное имя для ${base}`);
    }
}
module.exports = { ExtractPageMixin };
