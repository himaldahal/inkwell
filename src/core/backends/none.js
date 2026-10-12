// Local-only provider: no accounts, no network. Select with setting backend.provider = 'none'.
import { registerBackend } from '../backend.js';

const off = () => { throw new Error('This build runs in local-only mode (no cloud backend).'); };
export const noneAdapter = {
  name: 'none',
  capabilities: { accounts: false, sync: false, assets: false, chunkedUpload: false, rangeDownload: false, presence: false, sharing: false, publicLinks: false, admin: false, longPoll: false, settings: false },
  call: off, register: off, login: off, logout: async () => {}, refresh: off, me: off, changePassword: off, deleteAccount: off, listDevices: async () => [], revokeDevice: off,
  updateProfile: off, uploadAvatar: off, fetchBlob: async () => null, health: async () => ({ ok: true }),
  config: async () => ({ mode: 'local', registrationOpen: false, features: {} }),
  pull: async () => null, push: async () => ({ accepted: [], conflicts: [], rejected: [], serverTime: Date.now() }),
  uploadAsset: off, downloadAsset: async () => null, getSettings: async () => ({ settings: null, updatedAt: 0 }), putSettings: async () => ({ conflict: false, updatedAt: Date.now() }),
};
registerBackend('none', () => noneAdapter);
