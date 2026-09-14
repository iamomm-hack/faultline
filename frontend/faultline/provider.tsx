"use client";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { FaultlineClient } from "./client";
import { MockFaultlineClient } from "./mock-client";
const Context=createContext<FaultlineClient|null>(null);
export function FaultlineProvider({children}:{children:ReactNode}){const[client]=useState<FaultlineClient>(()=>new MockFaultlineClient());return <Context.Provider value={client}>{children}</Context.Provider>}
export function useFaultlineClient(){const c=useContext(Context);if(!c)throw new Error("FaultlineProvider missing");return c}
export function useFaultlineSnapshot(){const c=useFaultlineClient();return useSyncExternalStore((listener)=>c.subscribe(listener),()=>c.getSnapshot(),()=>c.getSnapshot())}
