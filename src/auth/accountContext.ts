import { createContext, useContext } from 'react';

/**
 * Switches an administrator turns on in 設定; anything missing counts as off. Keys match
 * `FEATURES` in server/features.mjs: the first two are the platform administrator's, the last
 * is the institution's own.
 */
export type FeatureSwitches = Partial<Record<'photoIntake' | 'workspaceSync' | 'aiAssistant', boolean>>;
/** What the workspace header needs from the signed-in account: its name, settings, switches and sign-out. */
/**
 * Where the workspace lives right now: `shared` once sync is on and this device unlocked the
 * institution key, `device` otherwise. Shown in the header, so nobody takes a local copy for
 * one colleagues can see.
 */
export type WorkspacePlace = 'shared' | 'device';
export interface AccountControls { name: string; role: 'ADMIN' | 'MEMBER'; busy: boolean; features: FeatureSwitches; workspace: WorkspacePlace; openSettings: () => void; logout: () => void; }
export const AccountContext = createContext<AccountControls | undefined>(undefined);
export const useAccount = () => useContext(AccountContext);
