import { createContext, useContext } from 'react';

/** Site-wide switches an administrator turns on in 設定; anything missing counts as off. */
export type FeatureSwitches = Partial<Record<'photoIntake' | 'workspaceSync', boolean>>;
/** What the workspace header needs from the signed-in account: its name, settings, switches and sign-out. */
export interface AccountControls { name: string; role: 'ADMIN' | 'MEMBER'; busy: boolean; features: FeatureSwitches; openSettings: () => void; logout: () => void; }
export const AccountContext = createContext<AccountControls | undefined>(undefined);
export const useAccount = () => useContext(AccountContext);
