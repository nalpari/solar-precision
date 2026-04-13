"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Site Analysis", icon: "map" },
  { href: "/irradiance", label: "Irradiance", icon: "wb_sunny" },
  { href: "/system", label: "System Config", icon: "settings_input_component" },
  { href: "/roi", label: "ROI Report", icon: "analytics" },
];

export function SideNav({
  footer,
  projectName = "Project Alpha",
  location = "Tokyo, Minato City",
}: {
  footer?: ReactNode;
  projectName?: string;
  location?: string;
}) {
  const pathname = usePathname();
  const activeHref =
    pathname === "/detect" ? "/" : (pathname ?? "/");

  return (
    <aside className="flex flex-col h-screen fixed left-0 top-0 pt-16 w-80 border-r border-outline-variant/15 bg-surface-container-low z-40">
      <div className="px-6 pb-4">
        <div className="flex flex-col gap-1 mb-8">
          <h2 className="font-headline font-bold text-xl text-on-surface tracking-tight">
            {projectName}
          </h2>
          <div className="flex items-center gap-2 text-tertiary">
            <span className="material-symbols-outlined text-sm">
              location_on
            </span>
            <span className="font-label text-xs font-medium tracking-tight">
              {location}
            </span>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  isActive
                    ? "flex items-center gap-3 px-4 py-3 bg-white text-primary border-l-4 border-primary transition-all duration-300 rounded-r-lg"
                    : "flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-surface-container transition-all duration-300 rounded-lg"
                }
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                <span className="font-body text-xs font-medium">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto p-6 border-t border-outline-variant/10">
        {footer}
        <button
          type="button"
          className="w-full mt-6 bg-primary text-on-primary font-headline font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 hover:bg-primary-container transition-all shadow-sm"
        >
          <span className="material-symbols-outlined text-base">download</span>
          Export Blueprint
        </button>
      </div>
    </aside>
  );
}
