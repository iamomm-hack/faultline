import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { FaultlineProvider } from "@/faultline/provider";
import "./globals.css";
const geist=Geist({variable:"--font-geist-sans",subsets:["latin"]});const mono=Geist_Mono({variable:"--font-geist-mono",subsets:["latin"]});
export const metadata:Metadata={metadataBase:new URL("https://faultline-gate.fine-vale-0544.chatgpt.site"),title:{default:"Faultline · Deployment gate",template:"%s · Faultline"},description:"Prototype control plane for enforceable Solana upgrade conditions.",openGraph:{title:"FAULTLINE",description:"Executable safety invariants. Enforced deployment conditions.",images:[{url:"/og.png",width:1200,height:630}]},twitter:{card:"summary_large_image",title:"FAULTLINE",description:"Executable safety invariants. Enforced deployment conditions.",images:["/og.png"]}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" className="dark"><body className={`${geist.variable} ${mono.variable}`}><FaultlineProvider><AppShell>{children}</AppShell></FaultlineProvider></body></html>}
