import { Link as ReactRouterLink, type LinkProps } from "react-router-dom";
import type { ReactNode } from "react";

export default function Link({ href, children, ...props }: Omit<LinkProps, "to"> & { href: string; children: ReactNode }) {
  return <ReactRouterLink to={href} {...props}>{children}</ReactRouterLink>;
}
