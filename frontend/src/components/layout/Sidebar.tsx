import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Search,
  Globe,
  Settings,
  History,
  Newspaper,
  BookOpen,
  Workflow,
  Layers,
  Shield,
  Server,
  Terminal,
  FileText,
  Activity,
  ChevronDown,
  Database,
  Gauge,
  CheckCircle,
  Zap,
  Monitor,
} from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

type SidebarProps = React.HTMLAttributes<HTMLDivElement>;

export function Sidebar({ className }: SidebarProps) {
  const location = useLocation();
  const [isAdminOpen, setIsAdminOpen] = useState(location.pathname.startsWith('/admin'));

  const navItems = [
    {
      title: "Smart Search",
      href: "/",
      icon: Search,
      variant: "default",
    },
    {
      title: "Live Dashboard",
      href: "/dashboard",
      icon: Activity,
      variant: "ghost",
    },
    {
      title: "Operations",
      href: "/operations",
      icon: Gauge,
      variant: "ghost",
    },
    {
      title: "Projects",
      href: "/projects",
      icon: BookOpen,
      variant: "ghost",
    },
    {
      title: "History",
      href: "/history",
      icon: History,
      variant: "ghost",
    },
    {
      title: "URL Collections",
      href: "/url-collections",
      icon: Globe,
      variant: "ghost",
    },
    {
      title: "Browser Agent",
      href: "/ai-agent",
      icon: Workflow,
      variant: "ghost",
    },
    {
      title: "ML Add-ons",
      href: "/ml-addons",
      icon: Layers,
      variant: "ghost",
    },
    {
      title: "Fact Check",
      href: "/factcheck",
      icon: CheckCircle,
      variant: "ghost",
    },
    {
      title: "Automation Jobs",
      href: "/ai-jobs",
      icon: Layers,
      variant: "ghost",
    },
    {
      title: "Collected Data",
      href: "/collected-data",
      icon: Database,
      variant: "ghost",
    },
  ];

  const adminItems = [
    {
      title: "Sources",
      href: "/admin/sources",
      icon: Newspaper,
    },
    {
      title: "Server Monitoring",
      href: "/admin/monitoring",
      icon: Monitor,
    },
    {
      title: "Environments",
      href: "/admin/environments",
      icon: Server,
    },
    {
      title: "Scripts",
      href: "/admin/scripts",
      icon: Terminal,
    },
    {
      title: "Audit Logs",
      href: "/admin/audit-logs",
      icon: FileText,
    },
    {
      title: "LLM Providers",
      href: "/admin/llm-providers",
      icon: Zap,
    },
  ];

  return (
    <div className={cn("pb-12 w-64 border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60", className)}>
      <div className="space-y-4 py-4">
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-4 mb-6">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <h2 className="text-lg font-bold tracking-tight">NewsInsight</h2>
          </div>
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors",
                  location.pathname === item.href ? "bg-accent text-accent-foreground" : "transparent"
                )}
              >
                <item.icon className="mr-2 h-4 w-4" />
                {item.title}
              </Link>
            ))}
          </div>
        </div>
        
        <div className="px-3 py-2">
          <Collapsible open={isAdminOpen} onOpenChange={setIsAdminOpen} className="space-y-1">
            <div className="flex items-center justify-between px-4 py-2">
              <h2 className="text-sm font-semibold tracking-tight text-muted-foreground flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Admin
              </h2>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-6 h-6 p-0">
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isAdminOpen ? "rotate-180" : "")} />
                  <span className="sr-only">Toggle Admin</span>
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="space-y-1">
              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors pl-8",
                    location.pathname === item.href ? "bg-accent text-accent-foreground" : "transparent"
                  )}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.title}
                </Link>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div className="px-3 py-2 mt-auto">
          <Link
            to="/settings"
            className={cn(
              "flex items-center rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors",
              location.pathname === "/settings" ? "bg-accent text-accent-foreground" : "transparent"
            )}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
