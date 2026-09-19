"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Download,
  Eye,
  FlaskConical,
  Info,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { UserSwitcher } from "@/components/board/user-switcher";
import { KpiBar } from "@/components/board/kpi-bar";
import { WorkflowBoard, type ActFn } from "@/components/board/workflow-board";
import { TemplateDialog } from "@/components/board/template-dialog";
import { PatientDrawer } from "@/components/board/patient-drawer";
import { ImportDialog } from "@/components/board/import-dialog";
import { SpecSheet } from "@/components/board/spec-sheet";
import { DischargedDialog } from "@/components/board/discharged-dialog";
import { AnalysisView } from "@/components/analysis/analysis-view";
import { AdminPanel } from "@/components/admin/admin-panel";
import { NotificationBell } from "@/components/shared/notification-bell";
import type {
  ActionJson,
  ActionType,
  PatientJson,
  UserJson,
} from "@/lib/workflow";
import {
  computeView,
  DEFAULT_DECISION_WINDOW_SEC,
  IMPORTER_ROLES,
  isVisibleTo,
  ROLE_LABELS,
} from "@/lib/workflow";
import { fmtClock } from "@/lib/format";

const POLL_MS = 10000;
const LS_USER_KEY = "dischargeflow.currentUserId";
const LS_ADMIN_KEY = "dischargeflow.adminUserId"; // set while an admin demos another view
const LS_FLOOR_KEY = "dischargeflow.workingFloor"; // per-nurse working floor choice

type Tab = "board" | "analysis" | "admin";

interface PatientsPayload {
  patients: PatientJson[];
  actions: ActionJson[];
  stats?: {
    dischargedTotal: number;
    dischargedToday: number;
    dischargedTodayBeforeNoon: number;
    medianTotalRecent: number | null;
  };
  /** Physician decision window (seconds) — admin-adjustable setting. */
  decisionWindowSec?: number;
}

export default function Home() {
  const { toast } = useToast();

  const [users, setUsers] = useState<UserJson[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [adminDemoOf, setAdminDemoOf] = useState<string | null>(null); // admin id while demoing
  const [patients, setPatients] = useState<PatientJson[] | null>(null);
  const [actions, setActions] = useState<ActionJson[]>([]);
  const [stats, setStats] = useState<PatientsPayload["stats"]>(undefined);
  /** Physician decision window length (s) — carried by the board payload so
   *  the stage-1 countdowns match the server exactly. */
  const [decisionWindowSec, setDecisionWindowSec] = useState(
    DEFAULT_DECISION_WINDOW_SEC
  );
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("board");

  const [search, setSearch] = useState("");
  const [floorFilter, setFloorFilter] = useState("all");
  /** Multi-floor nurses pick the floor they are working on (persisted). */
  const [workingFloor, setWorkingFloor] = useState<number | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [dischargedOpen, setDischargedOpen] = useState(false);
  /** Patient opened from the Discharged dialog (not on the live board). */
  const [dischargedDrawer, setDischargedDrawer] = useState<{
    patient: PatientJson;
    actions: ActionJson[];
  } | null>(null);
  const [templatePatientId, setTemplatePatientId] = useState<string | null>(null);
  const [drawerPatientId, setDrawerPatientId] = useState<string | null>(null);

  const currentUser = useMemo(
    () => users.find((u) => u.id === currentUserId) ?? null,
    [users, currentUserId]
  );
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  /** Admin demo mode: an admin is viewing the board as another user —
   *  strictly read-only (server-enforced on every mutation endpoint). */
  const demoMode = adminDemoOf !== null && adminDemoOf !== currentUserId;
  const demoAdmin = demoMode ? usersById.get(adminDemoOf ?? "") ?? null : null;

  // --- data loading ---------------------------------------------------------

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (!res.ok) throw new Error(`Users API ${res.status}`);
      const data = (await res.json()) as { users: UserJson[]; specialties: string[] };
      setUsers(data.users);
      setSpecialties(data.specialties);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    }
  }, []);

  const fetchPatients = useCallback(async () => {
    try {
      const res = await fetch("/api/patients", { cache: "no-store" });
      if (!res.ok) throw new Error(`Patients API ${res.status}`);
      const data = (await res.json()) as PatientsPayload;
      setPatients(data.patients);
      setActions(data.actions);
      setStats(data.stats);
      if (typeof data.decisionWindowSec === "number") {
        setDecisionWindowSec(data.decisionWindowSec);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load patients");
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchPatients();
    const poll = setInterval(fetchPatients, POLL_MS);
    return () => clearInterval(poll);
  }, [fetchPatients]);

  // restore acting user + demo state from localStorage once users are known
  useEffect(() => {
    if (users.length === 0) return;
    const stored = window.localStorage.getItem(LS_USER_KEY);
    const storedAdmin = window.localStorage.getItem(LS_ADMIN_KEY);
    if (stored && users.some((u) => u.id === stored)) {
      setCurrentUserId(stored);
      if (storedAdmin && users.some((u) => u.id === storedAdmin) && storedAdmin !== stored) {
        setAdminDemoOf(storedAdmin);
      } else if (storedAdmin) {
        window.localStorage.removeItem(LS_ADMIN_KEY);
      }
    } else {
      // default to an admin so the console + demo views are discoverable
      const firstAdmin = users.find((u) => u.role === "ADMIN") ?? users[0];
      setCurrentUserId(firstAdmin?.id ?? null);
    }
  }, [users]);

  const switchUser = useCallback((id: string) => {
    setCurrentUserId(id);
    window.localStorage.setItem(LS_USER_KEY, id);
    // picking a different identity always exits demo mode
    window.localStorage.removeItem(LS_ADMIN_KEY);
    setAdminDemoOf(null);
  }, []);

  const startDemoAs = useCallback(
    (userId: string) => {
      if (!currentUser || currentUser.role !== "ADMIN" || userId === currentUser.id) return;
      window.localStorage.setItem(LS_ADMIN_KEY, currentUser.id);
      setAdminDemoOf(currentUser.id);
      setCurrentUserId(userId);
      window.localStorage.setItem(LS_USER_KEY, userId);
      setTab("board");
      toast({
        title: "Demo view started",
        description: "Viewing the board exactly as this account sees it — read-only.",
      });
    },
    [currentUser, toast]
  );

  const exitDemo = useCallback(() => {
    if (!adminDemoOf) return;
    setCurrentUserId(adminDemoOf);
    window.localStorage.setItem(LS_USER_KEY, adminDemoOf);
    window.localStorage.removeItem(LS_ADMIN_KEY);
    setAdminDemoOf(null);
    setTab("admin");
  }, [adminDemoOf]);

  // multi-floor nurses: restore / default their working floor selection
  useEffect(() => {
    if (!currentUser || currentUser.role !== "NURSE" || currentUser.floors.length === 0) {
      setWorkingFloor(null);
      return;
    }
    const stored = Number(window.localStorage.getItem(`${LS_FLOOR_KEY}.${currentUser.id}`));
    const valid = currentUser.floors.includes(stored) ? stored : currentUser.floors[0];
    setWorkingFloor(valid);
  }, [currentUser]);

  const chooseWorkingFloor = useCallback(
    (floor: number) => {
      setWorkingFloor(floor);
      if (currentUser) {
        window.localStorage.setItem(`${LS_FLOOR_KEY}.${currentUser.id}`, String(floor));
      }
    },
    [currentUser]
  );

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // leaving the board tab closes transient dialogs
  useEffect(() => {
    if (tab !== "board") {
      setDrawerPatientId(null);
      setTemplatePatientId(null);
    }
  }, [tab]);

  // --- actions ---------------------------------------------------------------

  const act: ActFn = useCallback(
    async (patientId: string, type: ActionType, templateBody?: string) => {
      if (!currentUserId) return;
      const key = `${patientId}:${templateBody !== undefined ? "copy" : "act"}`;
      setBusyKey(key);
      setActionBusy(true);
      try {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId, userId: currentUserId, type, templateBody, demo: demoMode }),
        });
        const data = (await res.json()) as {
          patient?: PatientJson;
          action?: ActionJson;
          error?: string;
        };
        if (!res.ok || !data.patient) {
          toast({
            title: "Not allowed",
            description: data.error ?? "Action rejected",
            variant: "destructive",
          });
          return;
        }
        const updated = data.patient;
        setPatients((prev) => (prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev));
        if (data.action) setActions((prev) => [...prev, data.action as ActionJson]);
        // a discharge moves the patient off the live board — reload (also
        // refreshes the discharged stats behind the header button + KPI)
        if (updated.physicalDischargedAt) {
          fetchPatients();
        }
        setError(null);
      } catch (e) {
        toast({
          title: "Action failed",
          description: e instanceof Error ? e.message : "Network error",
          variant: "destructive",
        });
      } finally {
        setBusyKey(null);
        setActionBusy(false);
      }
    },
    [currentUserId, demoMode, toast]
  );

  const importCsv = useCallback(
    async (csv: string): Promise<{ created: number }> => {
      if (!currentUserId) return { created: 0 };
      try {
        const res = await fetch("/api/patients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv, userId: currentUserId, demo: demoMode }),
        });
        const data = (await res.json()) as {
          created?: number;
          errors?: string[];
          warnings?: string[];
          patients?: PatientJson[];
          actions?: ActionJson[];
          stats?: PatientsPayload["stats"];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Import failed");
        if (data.patients) setPatients(data.patients);
        if (data.actions) setActions(data.actions);
        if (data.stats) setStats(data.stats);
        if (data.created && data.created > 0) {
          toast({
            title: `Imported ${data.created} patient${data.created === 1 ? "" : "s"}`,
            description:
              data.warnings && data.warnings.length > 0
                ? data.warnings.slice(0, 3).join(" · ")
                : "All rows valid. Specialty physicians were notified.",
          });
        } else {
          toast({
            title: "Nothing imported",
            description: data.errors?.slice(0, 3).join(" · ") ?? "No valid rows found.",
            variant: "destructive",
          });
        }
        return { created: data.created ?? 0 };
      } catch (e) {
        toast({
          title: "Import failed",
          description: e instanceof Error ? e.message : "Network error",
          variant: "destructive",
        });
        return { created: 0 };
      }
    },
    [currentUserId, demoMode, toast]
  );

  const loadDemoData = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const res = await fetch(`/api/patients/demo?userId=${currentUserId}`, { method: "POST" });
      const data = (await res.json()) as PatientsPayload & {
        created?: { today: number; history: number };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Demo load failed");
      setPatients(data.patients);
      setActions(data.actions);
      toast({
        title: "Demo dataset loaded",
        description: `${data.created?.today ?? 0} patients on today's board + ${data.created?.history ?? 0} discharged over the past 30 days (feeds the Analysis tab).`,
      });
    } catch (e) {
      toast({
        title: "Could not load demo data",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  }, [currentUserId, toast]);

  // --- derived ---------------------------------------------------------------

  const views = useMemo(() => {
    if (!patients) return [];
    return patients.map((p) => computeView(p, now));
  }, [patients, now]);

  const visibleViews = useMemo(() => {
    if (!currentUser) return [];
    let list = views.filter((v) => isVisibleTo(currentUser, v));
    // a multi-floor nurse works on ONE chosen floor at a time
    if (currentUser.role === "NURSE" && workingFloor !== null) {
      list = list.filter((v) => v.floor === workingFloor);
    }
    if (currentUser.role !== "NURSE" && floorFilter !== "all") {
      list = list.filter((v) => v.floor === Number(floorFilter));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.mrn.toLowerCase().includes(q) ||
          v.room.toLowerCase().includes(q) ||
          v.doctorName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [views, currentUser, workingFloor, floorFilter, search]);

  const floors = useMemo(() => [...new Set(views.map((v) => v.floor))].sort((a, b) => a - b), [views]);
  const demoCount = useMemo(() => views.filter((v) => v.isDemo).length, [views]);

  // A pending DISCHARGE decision promotes on the server once its window
  // closes; refresh the board right at that moment so the card moves columns
  // immediately instead of waiting for the next 10s poll.
  useEffect(() => {
    const nextExpiry = views
      .filter(
        (v) =>
          v.stage === 1 &&
          v.medicalDecision === "DISCHARGE" &&
          v.medicalDecisionAt !== null
      )
      .map((v) => new Date(v.medicalDecisionAt as string).getTime() + decisionWindowSec * 1000)
      .filter((t) => t - Date.now() <= 10_500)
      .sort((a, b) => a - b)[0];
    if (nextExpiry === undefined) return;
    const delay = Math.max(150, nextExpiry - Date.now() + 250);
    const t = setTimeout(fetchPatients, delay);
    return () => clearTimeout(t);
  }, [views, decisionWindowSec, fetchPatients]);

  const drawerView = useMemo(
    () =>
      drawerPatientId
        ? views.find((v) => v.id === drawerPatientId) ??
          (dischargedDrawer?.patient.id === drawerPatientId
            ? computeView(dischargedDrawer.patient, now)
            : null)
        : null,
    [views, drawerPatientId, dischargedDrawer, now]
  );
  const drawerActions = useMemo(
    () => [...actions, ...(dischargedDrawer?.actions ?? [])],
    [actions, dischargedDrawer]
  );
  const templatePatient = useMemo(
    () =>
      templatePatientId
        ? patients?.find((p) => p.id === templatePatientId) ?? null
        : null,
    [patients, templatePatientId]
  );
  const medicalReadyByName = templatePatient?.medicalReadyById
    ? usersById.get(templatePatient.medicalReadyById)?.name ?? null
    : null;

  const roleNote = useMemo(() => {
    if (!currentUser) return null;
    if (demoMode) {
      return `Admin demo — viewing as ${currentUser.name} (${categoryLabel(currentUser)}). Actions are disabled; exit the demo to act as yourself.`;
    }
    switch (currentUser.role) {
      case "NURSE":
        return `Viewing as a nurse on Floor${workingFloor !== null ? ` ${workingFloor}` : "s " + currentUser.floors.join(", ")} — you drive the financial-notification email and the physical discharge steps.${currentUser.floors.length > 1 ? " Switch your working floor from the filter bar." : ""}`;
      case "PHYSICIAN":
        return `Viewing as ${currentUser.name} (${currentUser.specialty}) — you see only ${currentUser.specialty} patients and decide Discharge / No discharge for them. A ${decisionWindowSec}s confirmation window runs before the patient moves on — undo or change it there.`;
      case "FINANCE":
        return "Viewing as the financial team — you see notified patients (read-only) and mark them financially cleared.";
      case "RECEPTION":
        return "Viewing as reception — you see financially cleared patients and confirm their discharge papers; the rest of the pipeline stays with the other categories.";
      case "UNIVERSAL":
        return `Viewing as ${currentUser.name} (${
          currentUser.subcategory === "QUALITY" ? "Quality" : "Manager"
        }) — hospital-wide read-only oversight of the pipeline and its analysis.`;
      case "ADMIN":
        return "Viewing as admin — full oversight. Set privileges, alarm rules and demo views from the Admin tab.";
    }
    return null;
  }, [currentUser, demoMode, workingFloor, decisionWindowSec]);

  const loading = patients === null && users.length === 0 && !error;
  const isAdminAccount = currentUser?.role === "ADMIN" && !demoMode;
  const canImport =
    !!currentUser &&
    IMPORTER_ROLES.includes(currentUser.role) &&
    currentUser.canEdit &&
    currentUser.canView &&
    !demoMode;

  // --- render ----------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-[1700px] space-y-4 px-4 py-6">
          <Skeleton className="h-14 w-full" />
          <div className="grid gap-3 sm:grid-cols-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // Board hidden by admin privilege — nothing else to show
  if (currentUser && !currentUser.canView) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-[1700px] items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">DF</div>
            <div className="leading-tight">
              <div className="text-sm font-bold">DischargeFlow</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Role-based discharge workflow</div>
            </div>
            <div className="ml-auto text-xs text-slate-500">{currentUser.name}</div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-10">
          <Card className="shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <ShieldCheck className="h-8 w-8 text-slate-300" aria-hidden="true" />
              <h1 className="text-lg font-semibold">Board access disabled</h1>
              <p className="text-sm text-slate-500">
                An administrator set this account&rsquo;s viewing mode to off. Ask them to re-enable
                it from the Admin console (Users &amp; privileges).
              </p>
            </CardContent>
          </Card>
        </main>
        <footer className="mt-auto border-t border-slate-200 bg-white px-4 py-3 text-center text-[11px] text-slate-400">
          DischargeFlow — every step audited with time and user.
        </footer>
      </div>
    );
  }

  const TABS: Array<{ key: Tab; label: string; icon: typeof LayoutDashboard; visible: boolean }> = [
    { key: "board", label: "Dashboard", icon: LayoutDashboard, visible: true },
    { key: "analysis", label: "Analysis", icon: BarChart3, visible: true },
    { key: "admin", label: "Admin", icon: Settings2, visible: isAdminAccount },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
              DF
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold">DischargeFlow</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Role-based discharge workflow
              </div>
            </div>
          </div>

          {/* Tabs */}
          <nav className="order-3 w-full sm:order-none sm:w-auto" aria-label="Main views">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {TABS.filter((t) => t.visible).map((t) => {
                const Icon = t.icon;
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <UserSwitcher users={users} value={currentUserId} onChange={switchUser} />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <NotificationBell userId={currentUserId} onOpenPatient={(id) => { setTab("board"); setDrawerPatientId(id); }} />
            <span className="hidden font-mono text-xs tabular-nums text-slate-400 lg:inline">
              {fmtClock(now)}
            </span>
            {currentUser?.canView && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setDischargedOpen(true)}
                aria-label={`Discharged patients${stats ? ` (${stats.dischargedTotal})` : ""}`}
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Discharged
                {stats && stats.dischargedTotal > 0 && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                    {stats.dischargedTotal}
                  </span>
                )}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={fetchPatients}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={() => setSpecOpen(true)}>
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              Spec
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                window.location.href = "/api/export";
              }}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export
            </Button>
            {canImport && (
              <Button
                size="sm"
                className="h-9 gap-1.5 bg-teal-600 hover:bg-teal-700"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Import list
              </Button>
            )}
          </div>
        </div>

        {/* Demo banner */}
        {demoMode && demoAdmin && currentUser && (
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-violet-200 bg-violet-50 px-4 py-1.5 text-[11px] text-violet-800">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              <b>Admin demo</b> — {demoAdmin.name} is viewing as{" "}
              <b>
                {currentUser.name} ({categoryLabel(currentUser)})
              </b>
              . Read-only.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 border-violet-300 px-2 text-[10px] text-violet-800 hover:bg-violet-100 hover:text-violet-900"
              onClick={exitDemo}
            >
              Exit demo
            </Button>
          </div>
        )}

        {roleNote && !demoMode && (
          <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-1.5 text-center text-[11px] text-slate-500">
            {roleNote}
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="bg-rose-50 px-4 py-2 text-center text-xs text-rose-700">
          {error}
        </div>
      )}

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-4">
        {tab === "analysis" && <AnalysisView currentUser={currentUser} />}

        {tab === "admin" && isAdminAccount && currentUser && (
          <AdminPanel
            admin={currentUser}
            users={users}
            specialties={specialties}
            patients={patients}
            onUsersChange={(next) => {
              setUsers(next);
              fetchPatients();
            }}
            onBoardDataChange={(payload) => {
              setPatients(payload.patients);
              setActions(payload.actions);
            }}
            onDemoAs={startDemoAs}
          />
        )}

        {tab === "board" && (
          <>
            {patients && patients.length === 0 ? (
              <Card className="shadow-sm">
                <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                  <Upload className="h-8 w-8 text-slate-300" aria-hidden="true" />
                  <div>
                    <h1 className="text-lg font-semibold">Start by importing the patient list</h1>
                    <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
                      Paste the list from Excel/CSV — patient name, room (number coding, e.g. 201 =
                      floor 2), assigned doctor and specialty. The pipeline then runs:{" "}
                      <b>medical clearance</b> (specialty-matched physicians) →{" "}
                      <b>financial notification email</b> (nurse) → <b>financial clearance</b>{" "}
                      (finance team) → <b>reception papers</b> (reception personnel) →{" "}
                      <b>physical discharge</b> (nurse). Every step logs time and user, and task
                      owners are notified.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {canImport && (
                      <Button className="gap-1.5 bg-teal-600 hover:bg-teal-700" onClick={() => setImportOpen(true)}>
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        Import patient list
                      </Button>
                    )}
                    {isAdminAccount && currentUser && (
                      <Button variant="outline" className="gap-1.5" onClick={loadDemoData}>
                        <FlaskConical className="h-4 w-4" aria-hidden="true" />
                        Load demo dataset
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <KpiBar
                  views={visibleViews}
                  dischargedToday={stats?.dischargedToday ?? 0}
                  dischargedTodayBeforeNoon={stats?.dischargedTodayBeforeNoon ?? 0}
                  medianTotalRecent={stats?.medianTotalRecent ?? null}
                />

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name, MRN, room or doctor"
                      className="h-9 w-60 pl-8"
                      aria-label="Search patients"
                    />
                  </div>
                  {currentUser && currentUser.role === "NURSE" && currentUser.floors.length > 1 && (
                    <Select
                      value={workingFloor !== null ? String(workingFloor) : ""}
                      onValueChange={(v) => chooseWorkingFloor(Number(v))}
                    >
                      <SelectTrigger className="h-9 w-44" aria-label="Working floor">
                        <SelectValue placeholder="Working floor" />
                      </SelectTrigger>
                      <SelectContent>
                        {currentUser.floors.map((f) => (
                          <SelectItem key={f} value={String(f)}>
                            Working on Floor {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {currentUser && currentUser.role !== "NURSE" && (
                    <Select value={floorFilter} onValueChange={setFloorFilter}>
                      <SelectTrigger className="h-9 w-40" aria-label="Filter by floor">
                        <SelectValue placeholder="Floor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All floors</SelectItem>
                        {floors.map((f) => (
                          <SelectItem key={f} value={String(f)}>
                            Floor {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {demoCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700">
                      <FlaskConical className="h-3 w-3" aria-hidden="true" />
                      {demoCount} demo patients
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1 text-xs tabular-nums text-slate-500">
                    <Info className="h-3 w-3 text-slate-300" aria-hidden="true" />
                    {visibleViews.length} / {views.length} patients in your view
                  </span>
                </div>

                <WorkflowBoard
                  views={visibleViews}
                  currentUser={currentUser}
                  usersById={usersById}
                  onAct={act}
                  onOpenPatient={(id) => setDrawerPatientId(id)}
                  onOpenTemplate={(id) => setTemplatePatientId(id)}
                  busyKey={busyKey}
                  readOnly={demoMode || (currentUser ? !currentUser.canEdit : false)}
                  decisionWindowSec={decisionWindowSec}
                />
              </>
            )}
          </>
        )}
      </main>

      <footer className="mt-auto border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-[1700px] px-4 py-3 text-[11px] leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-600">Every step is audited</span> — each action
          records its timestamp and the user who completed it; task owners are notified on handoffs
          and stage alarms (webhook-routable, rules set by admins). Stage-duration targets are
          anchored to published benchmarks where they exist (3h total, 60-min reception,
          30-min physical) and marked draft otherwise — recalibrate once your real timestamps
          accumulate. Acting-user switcher simulates sign-in; connect real accounts via the same
          User model when auth is wired.
        </div>
      </footer>

      {/* Dialogs & sheets */}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        specialties={specialties}
        onSubmitCsv={importCsv}
      />
      <TemplateDialog
        open={!!templatePatient}
        onOpenChange={(o) => !o && setTemplatePatientId(null)}
        patient={templatePatient}
        currentUser={currentUser}
        medicalReadyByName={medicalReadyByName}
        onCopyTemplate={async (patientId, body) => {
          await act(patientId, "COPY_TEMPLATE", body);
        }}
        onMarkNotified={async (patientId) => {
          await act(patientId, "FINANCE_NOTIFIED");
        }}
        busy={actionBusy}
        readOnly={demoMode || (currentUser ? !currentUser.canEdit : false)}
      />
      <PatientDrawer
        open={!!drawerView}
        onOpenChange={(o) => !o && setDrawerPatientId(null)}
        patient={drawerView}
        actions={drawerActions}
      />
      {currentUser && (
        <DischargedDialog
          open={dischargedOpen}
          onOpenChange={setDischargedOpen}
          currentUser={currentUser}
          dischargedTotal={stats?.dischargedTotal ?? 0}
          onOpenPatient={(patient, dischargedDialogActions) => {
            setDischargedDrawer({ patient, actions: dischargedDialogActions });
            setDrawerPatientId(patient.id);
          }}
        />
      )}
      <SpecSheet open={specOpen} onOpenChange={setSpecOpen} />
    </div>
  );
}

function categoryLabel(u: UserJson): string {
  switch (u.role) {
    case "NURSE":
      return u.floors.length > 1
        ? `Nurse · Floors ${u.floors.join(" & ")}`
        : `Nurse · Floor ${u.floors[0] ?? "—"}`;
    case "PHYSICIAN":
      return `Physician · ${u.specialty}`;
    case "FINANCE":
      return ROLE_LABELS.FINANCE;
    case "RECEPTION":
      return ROLE_LABELS.RECEPTION;
    case "UNIVERSAL":
      return u.subcategory === "QUALITY" ? "Universal · Quality" : "Universal · Manager";
    case "ADMIN":
      return ROLE_LABELS.ADMIN;
  }
}
