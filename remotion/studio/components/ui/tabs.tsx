// Adapted from shadcn/ui (New York, Radix); see LICENSE.shadcn.
import type {ComponentProps} from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import {cn} from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({className,...props}:ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn('flex min-w-0 items-center gap-0.5 border-b border-border p-1.5',className)} {...props}/>;
}

export function TabsTrigger({className,...props}:ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn('inline-flex min-h-[44px] flex-auto items-center justify-center rounded-sm border-transparent bg-transparent px-1 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-offset-[-2px] data-[state=active]:border-primary/40 data-[state=active]:bg-background data-[state=active]:text-primary min-[781px]:min-h-9',className)} {...props}/>;
}

export function TabsContent({className,...props}:ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('min-w-0 focus-visible:outline-offset-[-2px] data-[state=inactive]:hidden',className)} {...props}/>;
}
