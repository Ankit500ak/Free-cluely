const { ipcRenderer } = require('electron');

// Utility: map skill key to user-friendly label
const SKILL_LABELS = {
	"dsa": "DSA",
	"mcq": "MCQ",
	"reasoning": "Reasoning",
	"text": "Text",
	"rephrase": "Rephrase",
};

// Render helper
function renderSkillsInto(select, skills) {
	select.innerHTML = "";
	skills.forEach((key) => {
		const opt = document.createElement("option");
		opt.value = key;
		opt.textContent = SKILL_LABELS[key] || key;
		select.appendChild(opt);
	});
	// ack to main for debugging
	try {
		ipcRenderer.send("skills-ack", {
			source: document.title || window.location.href || "renderer",
			skillsCount: skills.length,
			skills
		});
	} catch (e) {}
}

// Map main activeSkill (effective) back to a display key (handles aliases)
function findDisplayKeyForActive(activeSkill, skillsList = [], aliases = {}) {
	// If the effective skill exists as a display key, use it
	if (skillsList.includes(activeSkill)) return activeSkill;
	// If an alias maps to the effective skill, prefer that alias if present in skillsList
	for (const [aliasKey, mapped] of Object.entries(aliases || {})) {
		if (mapped === activeSkill && skillsList.includes(aliasKey)) return aliasKey;
	}
	// If the effective skill equals a mapped value but no alias present, try to find the mapped key by name
	for (const key of skillsList) {
		if (key === activeSkill) return key;
	}
	// fallback to first available
	return skillsList[0] || null;
}

// Try to get select element reliably (wait if renderer builds it later)
function getSkillSelect(timeoutMs = 5000) {
	const start = Date.now();
	return new Promise((resolve) => {
		const attempt = () => {
			const sel = document.getElementById("skillSelect");
			if (sel) return resolve(sel);
			if (Date.now() - start > timeoutMs) return resolve(null);
			setTimeout(attempt, 120);
		};
		attempt();
	});
}

// Populate dropdown by invoking main; retry a few times if empty
async function populateSkillDropdown(retries = 4) {
	const select = await getSkillSelect();
	if (!select) return;

	const mergeWithKnown = (mainSkills) => {
		const known = Object.keys(SKILL_LABELS || {});
		const combined = Array.from(new Set([...(Array.isArray(mainSkills) ? mainSkills : []), ...known]));
		return combined;
	};

	// Request structured payload from main
	try {
		let payload = await ipcRenderer.invoke("get-available-skills");
		// payload might be {skills, aliases} or legacy array
		let skills = [];
		let aliases = {};
		let active = null;
		if (Array.isArray(payload)) {
			skills = payload;
		} else if (payload && typeof payload === "object") {
			skills = Array.isArray(payload.skills) ? payload.skills : [];
			aliases = payload.aliases || {};
			active = payload.activeSkill || null;
		}
		skills = mergeWithKnown(skills);

		if (Array.isArray(skills) && skills.length > 0) {
			renderSkillsInto(select, skills);
			// set current selection to match activeSkill (mapped back to display key)
			const displayKey = findDisplayKeyForActive(active || await ipcRenderer.invoke("get-active-skill").catch(()=>null), skills, aliases);
			if (displayKey) select.value = displayKey;
			return;
		}
	} catch (e) {
		// fall through to retry loop
	}

	// Retries in case main hasn't provided skills yet
	let attempt = 0;
	const interval = setInterval(async () => {
		attempt++;
		try {
			let payload = await ipcRenderer.invoke("get-available-skills");
			let skills = [];
			let aliases = {};
			let active = null;
			if (Array.isArray(payload)) skills = payload;
			else if (payload && typeof payload === "object") {
				skills = Array.isArray(payload.skills) ? payload.skills : [];
				aliases = payload.aliases || {};
				active = payload.activeSkill || null;
			}
			skills = mergeWithKnown(skills);
			if (Array.isArray(skills) && skills.length > 0) {
				clearInterval(interval);
				renderSkillsInto(select, skills);
				const displayKey = findDisplayKeyForActive(active || await ipcRenderer.invoke("get-active-skill").catch(()=>null), skills, aliases);
				if (displayKey) select.value = displayKey;
				return;
			}
		} catch (e) {}
		if (attempt >= retries) clearInterval(interval);
	}, 300);
}

// Listen for structured broadcasts
ipcRenderer.on("available-skills", (event, payload) => {
	try {
		let skills = [];
		let aliases = {};
		let active = null;
		if (Array.isArray(payload)) skills = payload;
		else if (payload && typeof payload === "object") {
			skills = Array.isArray(payload.skills) ? payload.skills : [];
			aliases = payload.aliases || {};
			active = payload.activeSkill || null;
		}
		const select = document.getElementById("skillSelect");
		if (!select) return;
		const combined = Array.from(new Set([...(skills || []), ...Object.keys(SKILL_LABELS || {})]));
		renderSkillsInto(select, combined);
		const displayKey = findDisplayKeyForActive(active || null, combined, aliases);
		if (displayKey) select.value = displayKey;
	} catch (e) {}
});

// When user changes selection, notify main (now awaits response and syncs)
document.addEventListener("change", async (ev) => {
	try {
		const sel = ev.target;
		if (!sel || sel.id !== "skillSelect") return;
		const key = sel.value;

		// invoke and fallback-send so main gets update and replies with mapped skill
		let result = null;
		try {
			result = await ipcRenderer.invoke("update-active-skill", key);
		} catch (e) {
			// still send for older listeners
			ipcRenderer.send("update-skill", key);
		}

		// If invoke returned mapped skill, reflect that in UI (map active -> display key)
		try {
			if (result && result.success) {
				// reconcile: result.skill is the effective mapped skill (e.g. "reasoning")
				const payload = await ipcRenderer.invoke("get-available-skills").catch(() => null);
				let skills = Array.isArray(payload) ? payload : (payload && payload.skills) ? payload.skills : (Array.isArray(await ipcRenderer.invoke("get-available-skills")) ? await ipcRenderer.invoke("get-available-skills") : []);
				const aliases = payload && payload.aliases ? payload.aliases : {};
				const displayKey = findDisplayKeyForActive(result.skill || result, skills, aliases);
				if (displayKey && sel.value !== displayKey) sel.value = displayKey;
			}
		} catch (e) {}

		console.debug("[skills.js] user selected skill -> requested:", key, "mainResult:", result);
	} catch (e) {
		console.debug("[skills.js] selection handler error", e);
	}
});

// Keep select synced when main broadcasts changes
ipcRenderer.on("skill-changed", (event, payload) => {
	try {
		const select = document.getElementById("skillSelect");
		if (!select) return;
		const skills = Array.from(select.options).map(o => o.value);
		const aliases = (payload && payload.aliases) ? payload.aliases : {};
		const active = payload && payload.skill ? payload.skill : (payload && payload.selected ? (aliases[payload.selected] || payload.selected) : null);
		const displayKey = findDisplayKeyForActive(active, skills, aliases);
		if (displayKey) select.value = displayKey;
		console.debug("[skills.js] skill-changed -> set select to", displayKey, "payload:", payload);
	} catch (e) {}
});

ipcRenderer.on("skill-updated", (event, payload) => {
	try {
		const select = document.getElementById("skillSelect");
		if (!select) return;
		const skills = Array.from(select.options).map(o => o.value);
		const aliases = (payload && payload.aliases) ? payload.aliases : {};
		const active = payload && payload.skill ? payload.skill : (payload && payload.selected ? (aliases[payload.selected] || payload.selected) : null);
		const displayKey = findDisplayKeyForActive(active, skills, aliases);
		if (displayKey) select.value = displayKey;
		console.debug("[skills.js] skill-updated -> set select to", displayKey, "payload:", payload);
	} catch (e) {}
});

// Ensure dropdown is initially populated when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
	populateSkillDropdown().catch(() => {});
});