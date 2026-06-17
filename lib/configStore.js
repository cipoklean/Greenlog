'use strict';

// lib/configStore.js — per-workspace settings persistence for Slack apps.
// Stores { workspaceKey: {...} } at data/config.json, where workspaceKey is
// the enterprise_id (for Enterprise Grid installs) or team_id otherwise.
// Defensive read with corrupt-file rename + write mutex.

const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

let writeChain = Promise.resolve();

async function ensureDataDir() {
    try { await fs.mkdir(DATA_DIR, { recursive: true }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
}

async function readAllConfigs() {
    let raw;
    try { raw = await fs.readFile(CONFIG_PATH, 'utf8'); }
    catch (readErr) {
        if (readErr.code === 'ENOENT') return {};
        throw readErr;
    }
    if (!raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
    const corruptPath = CONFIG_PATH + '.corrupt-' + Date.now();
    try { await fs.rename(CONFIG_PATH, corruptPath); } catch (_) {}
    return {};
}

async function writeAllConfigs(configs) {
    await ensureDataDir();
    await fs.writeFile(CONFIG_PATH, JSON.stringify(configs, null, 2), 'utf8');
}

/**
 * Compute the workspace storage key. Prefers enterprise_id (so all Enterprise
 * Grid workspaces share one config entry, matching how auth.test reports
 * identity for org-wide bot installs), falls back to team_id for standalone
 * workspaces. Accepts both snake_case and camelCase field names.
 */
function workspaceKey(payload = {}) {
    const enterpriseId = payload.enterprise_id || payload.enterpriseId || null;
    const teamId = payload.team_id || payload.teamId || null;
    return enterpriseId || teamId || null;
}

async function getConfig(key) {
    if (!key) return {};
    const all = await readAllConfigs();
    return all[key] || {};
}

async function updateConfig(key, patch) {
    if (!key) throw new Error('updateConfig requires workspace key');
    if (!patch || typeof patch !== 'object') throw new Error('updateConfig requires patch object');
    const op = async () => {
        const all = await readAllConfigs();
        const prev = all[key] || {};
        const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
        all[key] = next;
        await writeAllConfigs(all);
        return next;
    };
    writeChain = writeChain.then(op, op);
    return writeChain;
}

async function setDigestChannel(key, channelId) { return updateConfig(key, { digestChannel: channelId }); }
async function setTimezone(key, timezone) { return updateConfig(key, { timezone }); }

function isValidTimezone(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; }
    catch (_) { return false; }
}

/**
 * Resolve digest channel + timezone. Pass both teamId and enterpriseId when
 * available; lookup key uses enterprise_id on Enterprise Grid, team_id otherwise.
 */
async function resolveWorkspaceConfig({ teamId, enterpriseId, fallbackChannel } = {}) {
    const key = workspaceKey({ team_id: teamId, enterprise_id: enterpriseId });
    const cfg = key ? await getConfig(key) : {};
    const envChannel = process.env.GREENLOG_DIGEST_CHANNEL || null;
    const envTz = process.env.GREENLOG_TZ || null;
    return {
        digestChannel: cfg.digestChannel || envChannel || fallbackChannel || null,
        timezone: cfg.timezone || envTz || 'UTC',
        workspaceKey: key,
        sources: {
            digestChannel: cfg.digestChannel ? 'config' : envChannel ? 'env' : fallbackChannel ? 'fallback' : 'none',
            timezone: cfg.timezone ? 'config' : envTz ? 'env' : 'default',
        },
    };
}

module.exports = {
    readAllConfigs, getConfig, updateConfig, setDigestChannel, setTimezone,
    isValidTimezone, resolveWorkspaceConfig, workspaceKey,
};
