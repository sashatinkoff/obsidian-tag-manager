"use strict";
/** Массовое редактирование YAML-атрибутов заметок. */
const { Notice, setIcon } = require("obsidian");
const { makeIgnoredPathMatcher } = require("../scanner.js");
const { pluralRu } = require("../utils.js");

class AttributesPageMixin {
    renderAttributesManagement(shell) {
        const intro = shell.createDiv({ cls: "tra-bulk-intro" });
        intro.createEl("h3", { text: "Массовое изменение атрибутов" });
        intro.createEl("p", { text: "Выберите папку или отфильтруйте заметки, отметьте файлы и добавьте либо обновите YAML-атрибуты. Существующие значения выбранного атрибута будут заменены." });

        const layout = shell.createDiv({ cls: "tra-bulk-layout tra-attributes-layout" });
        const controls = layout.createDiv({ cls: "tra-bulk-controls-card" });
        const header = controls.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(header.createSpan({ cls: "tra-bulk-heading-icon" }), "sliders-horizontal");
        header.createEl("h3", { text: "Фильтр и атрибуты" });

        const group = (label) => {
            const el = controls.createDiv({ cls: "tra-bulk-form-group" });
            el.createEl("label", { text: label });
            return el;
        };
        const folderGroup = group("Папка");
        const folder = folderGroup.createEl("input", { cls: "tra-bulk-input", attr: { type: "text", list: "tra-attributes-folder-options", placeholder: "Все папки", autocomplete: "off", spellcheck: "false", "aria-label": "Папка хранилища" } });
        folder.value = this.attrFolder;
        const folderOptions = folderGroup.createEl("datalist", { attr: { id: "tra-attributes-folder-options" } });
        for (const name of this.getVaultFolders()) folderOptions.createEl("option", { attr: { value: name } });

        const dateGroup = group("Дата файла (по имени)");
        const dateRow = dateGroup.createDiv({ cls: "tra-bulk-date-row" });
        const from = dateRow.createEl("input", { cls: "tra-bulk-input", attr: { type: "date", "aria-label": "Дата от" } });
        from.value = this.attrDateFrom;
        const to = dateRow.createEl("input", { cls: "tra-bulk-input", attr: { type: "date", "aria-label": "Дата до" } });
        to.value = this.attrDateTo;

        const tagGroup = group("Тег (заметки должны содержать)");
        const tag = tagGroup.createEl("input", { cls: "tra-bulk-input", attr: { type: "text", list: "tra-attributes-tags", placeholder: "Любой тег", autocomplete: "off" } });
        tag.value = this.attrTag;
        const tagList = tagGroup.createEl("datalist", { attr: { id: "tra-attributes-tags" } });
        for (const info of this.plugin.tagIndex.values()) tagList.createEl("option", { attr: { value: info.tag } });
        const textGroup = group("Поиск по имени файла");
        const text = textGroup.createEl("input", { cls: "tra-bulk-input", attr: { type: "search", placeholder: "Часть названия…" } });
        text.value = this.attrQuery;

        const attrGroup = group("Имя YAML-атрибута");
        const key = attrGroup.createEl("input", { cls: "tra-bulk-input", attr: { type: "text", placeholder: "Например: Автор" } });
        key.value = this.attrKey;
        const valueGroup = group("Новое значение");
        const value = valueGroup.createEl("input", { cls: "tra-bulk-input", attr: { type: "text", placeholder: "Значение для всех выбранных файлов" } });
        value.value = this.attrValue;
        const dateOption = controls.createDiv({ cls: "tra-attributes-date-option" });
        const dateCheck = dateOption.createEl("input", { attr: { type: "checkbox", id: "tra-attributes-add-date" } });
        dateCheck.checked = this.attrAddFilenameDate;
        dateOption.createEl("label", { text: "Записать атрибут «Дата» из имени файла", attr: { for: "tra-attributes-add-date" } });
        const dateHint = controls.createDiv({ cls: "tra-bulk-hint", text: "Формат имени: YYYY-MM-dd HH-mm или YYYY-MM-dd HH-mm-ss. Атрибут «Дата» будет первым в YAML." });

        const result = layout.createDiv({ cls: "tra-bulk-results-card" });
        const resultHead = result.createDiv({ cls: "tra-bulk-card-heading" });
        setIcon(resultHead.createSpan({ cls: "tra-bulk-heading-icon" }), "files");
        resultHead.createEl("h3", { text: "Файлы" });
        const actions = result.createDiv({ cls: "tra-attributes-toolbar" });
        const count = actions.createSpan({ cls: "tra-bulk-results-count", text: "0 файлов" });
        const selectAll = actions.createEl("button", { cls: "tra-secondary-button", text: "Выбрать все" });
        const clear = actions.createEl("button", { cls: "tra-secondary-button", text: "Снять выбор" });
        const list = result.createDiv({ cls: "tra-attributes-file-list" });
        const apply = result.createEl("button", { cls: "tra-primary-button tra-attributes-apply", text: "Применить изменения" });

        const filters = () => {
            this.attrFolder = folder.value; this.attrDateFrom = from.value; this.attrDateTo = to.value;
            this.attrTag = tag.value.trim().replace(/^#/, ""); this.attrQuery = text.value.trim();
            const needle = this.attrQuery.toLocaleLowerCase();
            const wantedTag = this.attrTag.toLocaleLowerCase();
            const isIgnored = makeIgnoredPathMatcher(this.plugin.settings.ignoredFolders ?? []);
            return this.plugin.app.vault.getMarkdownFiles().filter(file => {
                if (isIgnored(file.path)) return false;
                if (this.attrFolder && file.parent?.path !== this.attrFolder && !file.path.startsWith(`${this.attrFolder}/`)) return false;
                const filenameDate = this.parseFilenameDate(file.basename);
                const filenameDateKey = filenameDate ? `${new Date(filenameDate).getFullYear()}-${String(new Date(filenameDate).getMonth()+1).padStart(2,"0")}-${String(new Date(filenameDate).getDate()).padStart(2,"0")}` : "";
                if (this.attrDateFrom && (!filenameDateKey || filenameDateKey < this.attrDateFrom)) return false;
                if (this.attrDateTo && (!filenameDateKey || filenameDateKey > this.attrDateTo)) return false;
                if (wantedTag && !this.getTagsForFile(file).some(t => t.toLocaleLowerCase() === wantedTag)) return false;
                if (needle && !file.basename.toLocaleLowerCase().includes(needle)) return false;
                return true;
            }).sort((a,b) => a.path.localeCompare(b.path));
        };
        const renderFiles = () => {
            list.empty(); this.attrVisibleFiles = filters(); this.attrSelectedPaths.clear();
            count.setText(`${this.attrVisibleFiles.length} ${pluralRu(this.attrVisibleFiles.length, "файл", "файла", "файлов")}`);
            if (!this.attrVisibleFiles.length) { list.createDiv({ cls: "tra-bulk-empty", text: "По заданным условиям файлы не найдены." }); return; }
            for (const file of this.attrVisibleFiles) {
                const row = list.createDiv({ cls: "tra-attributes-file-row" });
                const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
                checkbox.addEventListener("change", () => { if (checkbox.checked) this.attrSelectedPaths.add(file.path); else this.attrSelectedPaths.delete(file.path); });
                const info = row.createDiv({ cls: "tra-attributes-file-info" });
                info.createDiv({ cls: "tra-attributes-file-name", text: file.basename });
                info.createDiv({ cls: "tra-attributes-file-path", text: file.parent?.path || "Корень хранилища" });
                if (this.attrAddFilenameDate) {
                    const parsed = this.parseFilenameDate(file.basename);
                    if (parsed) info.createDiv({ cls: "tra-attributes-file-date", text: `Дата: ${this.formatFilenameDate(parsed, file.basename)}` });
                }
            }
        };
        for (const input of [folder, from, to, tag]) input.addEventListener("change", renderFiles);
        for (const input of [folder, text]) input.addEventListener("input", renderFiles);
        dateCheck.addEventListener("change", () => { this.attrAddFilenameDate = dateCheck.checked; renderFiles(); });
        selectAll.addEventListener("click", () => { for (const row of list.querySelectorAll("input[type=checkbox]")) row.checked = true; this.attrSelectedPaths = new Set(this.attrVisibleFiles.map(f => f.path)); });
        clear.addEventListener("click", () => { this.attrSelectedPaths.clear(); for (const row of list.querySelectorAll("input[type=checkbox]")) row.checked = false; });
        apply.addEventListener("click", async () => {
            this.attrKey = key.value.trim(); this.attrValue = value.value;
            this.attrAddFilenameDate = dateCheck.checked;
            if (!this.attrSelectedPaths.size) { new Notice("Выберите хотя бы один файл."); return; }
            if ((!this.attrKey || !this.attrValue.trim()) && !this.attrAddFilenameDate) { new Notice("Укажите имя атрибута и значение либо включите добавление даты."); return; }
            if (this.attrKey.toLowerCase() === "дата" && this.attrAddFilenameDate) { new Notice("Атрибут «Дата» зарезервирован для даты из имени файла."); return; }
            const files = this.attrVisibleFiles.filter(f => this.attrSelectedPaths.has(f.path));
            apply.disabled = true;
            let changed = 0, skippedDates = 0, errors = 0;
            try {
                for (const file of files) {
                    try {
                        await this.plugin.app.fileManager.processFrontMatter(file, fm => {
                            if (this.attrAddFilenameDate) {
                                const timestamp = this.parseFilenameDate(file.basename);
                                if (timestamp) {
                                    const dateValue = this.formatFilenameDate(timestamp, file.basename);
                                    const rest = Object.entries(fm).filter(([k]) => k !== "Дата");
                                    for (const k of Object.keys(fm)) delete fm[k];
                                    fm["Дата"] = dateValue;
                                    for (const [k, v] of rest) fm[k] = v;
                                } else skippedDates++;
                            }
                            if (this.attrKey && this.attrValue.trim()) fm[this.attrKey] = this.attrValue;
                        });
                        changed++;
                    } catch (error) { errors++; console.error("Tag Refactor: YAML update failed", file.path, error); }
                }
                new Notice(`Готово: изменено ${changed} ${pluralRu(changed, "файл", "файла", "файлов")}${skippedDates ? `, без даты в имени: ${skippedDates}` : ""}${errors ? `, ошибок: ${errors}` : ""}.`, 8000);
            } finally { apply.disabled = false; }
        });
        renderFiles();
    }
    parseFilenameDate(name) {
        const match = name.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2})-(\d{2})(?:-(\d{2}))?)?$/);
        if (!match) return null;
        const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
        const date = new Date(Number(y), Number(mo)-1, Number(d), Number(h), Number(mi), Number(s));
        if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo)-1 || date.getDate() !== Number(d) || Number(h)>23 || Number(mi)>59 || Number(s)>59) return null;
        return date.getTime();
    }
    formatFilenameDate(timestamp, filename = "") {
        const date = new Date(timestamp);
        const dayAndMonth = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
        const year = date.getFullYear();
        const datePart = `${dayAndMonth} ${year}`;
        // A date-only filename remains a date-only value; time is included only when present.
        const hasTime = /^(\d{4})-(\d{2})-(\d{2})\s+\d{2}-\d{2}(?:-\d{2})?$/.test(filename);
        return datePart + (hasTime ? `, ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}` : "");
    }
}
module.exports = { AttributesPageMixin };
