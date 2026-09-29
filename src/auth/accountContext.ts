import { createContext, useContext } from 'react';

/** What the workspace header needs from the signed-in account: its name, settings and sign-out. */
export interface AccountControls { name: string; role: 'ADMIN' | 'MEMBER'; busy: boolean; openSettings: () => void; logout: () => void; }
export const AccountContext = createContext<AccountControls | undefined>(undefined);
export const useAccount = () => useContext(AccountContext);
