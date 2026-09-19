"use client";

import React, { useState, createContext, useContext } from "react";
import { cn } from "@/lib/utils";

const TabsContext = createContext<{ activeTab: string; setActiveTab: (v: string) => void }>({
  activeTab: "",
  setActiveTab: () => {},
});

interface TabsProps {
  defaultValue: string;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ defaultValue, children, className }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultValue);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-1 border-b border-border", className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const { activeTab, setActiveTab } = useContext(TabsContext);
  return (
    <button
      onClick={() => setActiveTab(value)}
      className={cn(
        "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
        activeTab === value
          ? "text-accent border-accent"
          : "text-muted border-transparent hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const { activeTab } = useContext(TabsContext);
  if (activeTab !== value) return null;
  return <div className={cn("animate-fade-in", className)}>{children}</div>;
}
