"use client";

import { useCallback, useState } from "react";
import { Eye, EyeOff, Loader2, PencilLine, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { UserJson } from "@/lib/workflow";

interface UsersSectionProps {
  admin: UserJson;
  users: UserJson[];
  specialties: string[];
  onUsersChange: (users: UserJson[]) => void;
}

interface CategoryGroup {
  key: string;
  label: string;
  role: string;
  subcategory?: string;
}

const CATEGORY_GROUPS: CategoryGroup[] = [
  { key: "nurse", label: "Nurses (by floor)", role: "NURSE" },
  { key: "physician", label: "Physicians (by specialty)", role: "PHYSICIAN" },
  { key: "finance", label: "Financial team", role: "FINANCE" },
  { key: "reception", label: "Reception", role: "RECEPTION" },
  { key: "manager", label: "Universal — managers", role: "UNIVERSAL", subcategory: "MANAGER" },
  { key: "quality", label: "Universal — quality", role: "UNIVERSAL", subcategory: "QUALITY" },
];

function floorsLabel(floors: number[]): string {
  return floors.length > 1 ? `Floors ${floors.join(" & ")}` : `Floor ${floors[0] ?? "—"}`;
}

function roleBadge(u: UserJson): { label: string; cls: string } {
  switch (u.role) {
    case "ADMIN":
      return { label: "Admin", cls: "bg-violet-100 text-violet-800" };
    case "UNIVERSAL":
      return {
        label: u.subcategory === "QUALITY" ? "Quality" : "Manager",
        cls: "bg-teal-100 text-teal-800",
      };
    case "NURSE":
      return { label: `Nurse · ${floorsLabel(u.floors)}`, cls: "bg-emerald-100 text-emerald-800" };
    case "PHYSICIAN":
      return { label: u.specialty ?? "Physician", cls: "bg-amber-100 text-amber-800" };
    case "FINANCE":
      return { label: "Finance", cls: "bg-rose-100 text-rose-800" };
    case "RECEPTION":
      return { label: "Reception", cls: "bg-indigo-100 text-indigo-800" };
  }
}

/** Admin > Users & privileges: the editing/viewing mode of every other user
 *  category — per account or per whole category at once. */
export function UsersSection({ admin, users, specialties, onUsersChange }: UsersSectionProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const patchPrivilege = useCallback(
    async (payload: {
      userId?: string;
      scope?: { role: string; subcategory?: string };
      canEdit?: boolean;
      canView?: boolean;
    }) => {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, actingUserId: admin.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { users?: UserJson[]; error?: string };
      if (!res.ok) {
        toast({ title: "Update rejected", description: data.error, variant: "destructive" });
        return false;
      }
      if (data.users) onUsersChange(data.users);
      return true;
    },
    [admin.id, onUsersChange, toast]
  );

  const updateUser = useCallback(
    async (userId: string, patch: { canEdit?: boolean; canView?: boolean }, name: string) => {
      setBusyId(userId);
      const ok = await patchPrivilege({ userId, ...patch });
      if (ok) {
        toast({
          title: "Privilege updated",
          description: `${name} → ${patch.canEdit === false || patch.canView === false ? "restricted" : "full access"}`,
        });
      }
      setBusyId(null);
    },
    [patchPrivilege, toast]
  );

  const applyToCategory = useCallback(
    async (group: CategoryGroup, patch: { canEdit: boolean; canView: boolean }) => {
      setGroupBusy(group.key);
      const ok = await patchPrivilege({
        scope: { role: group.role, subcategory: group.subcategory },
        ...patch,
      });
      if (ok) {
        toast({
          title: `${group.label} updated`,
          description: patch.canView
            ? patch.canEdit
              ? "Full editing access granted to the whole category"
              : "Whole category set to view-only mode"
            : "Whole category hidden from the board",
        });
      }
      setGroupBusy(null);
    },
    [patchPrivilege, toast]
  );

  const patchFloors = useCallback(
    async (userId: string, floors: number[], name: string) => {
      setBusyId(userId);
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, floors, actingUserId: admin.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { users?: UserJson[]; error?: string };
      if (!res.ok) {
        toast({ title: "Floors not saved", description: data.error, variant: "destructive" });
      } else {
        if (data.users) onUsersChange(data.users);
        toast({
          title: "Floors updated",
          description: `${name} → ${floorsLabel(floors)}${floors.length > 1 ? " — picks the working floor when acting" : ""}`,
        });
      }
      setBusyId(null);
    },
    [admin.id, onUsersChange, toast]
  );

  const addUser = useCallback(
    async (form: { name: string; role: string; floors: string; specialty: string; subcategory: string }) => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: admin.id,
          name: form.name,
          role: form.role,
          floors:
            form.role === "NURSE"
              ? form.floors
                  .split("[,\\s]+")
                  .map((f) => Number(f))
                  .filter((f) => Number.isInteger(f) && f >= 1 && f <= 30)
              : null,
          specialty: form.role === "PHYSICIAN" ? form.specialty : null,
          subcategory: form.role === "UNIVERSAL" ? form.subcategory : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { users?: UserJson[]; error?: string };
      if (!res.ok) {
        toast({ title: "Could not create user", description: data.error, variant: "destructive" });
        return;
      }
      if (data.users) onUsersChange(data.users);
      setAddOpen(false);
      toast({ title: "Account created", description: `${form.name} can sign in via the switcher.` });
    },
    [admin.id, onUsersChange, toast]
  );

  const deleteUser = useCallback(
    async (userId: string, name: string) => {
      setBusyId(userId);
      const res = await fetch(
        `/api/users?id=${encodeURIComponent(userId)}&actingUserId=${encodeURIComponent(admin.id)}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as { users?: UserJson[]; error?: string };
      if (!res.ok) {
        toast({ title: "Could not delete", description: data.error, variant: "destructive" });
      } else {
        if (data.users) onUsersChange(data.users);
        toast({
          title: `Deleted ${name}`,
          description: "Accounts that own logged actions stay blocked — audit integrity first.",
        });
      }
      setBusyId(null);
    },
    [admin.id, onUsersChange, toast]
  );

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Users & privileges</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Admins set the editing / viewing mode of every other user category — per account,
              or per whole category. Admin accounts themselves are locked to prevent lockout.
            </p>
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add user
          </Button>
        </div>

        {/* Category bulk controls */}
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {CATEGORY_GROUPS.map((group) => {
            const members = users.filter(
              (u) =>
                u.role === group.role &&
                (group.subcategory ? u.subcategory === group.subcategory : true)
            );
            const editing = members.filter((m) => m.canEdit && m.canView).length;
            const viewOnly = members.filter((m) => !m.canEdit && m.canView).length;
            const hidden = members.filter((m) => !m.canView).length;
            return (
              <div key={group.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">{group.label}</span>
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {members.length} account{members.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
                    {editing} editing
                  </span>
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">
                    {viewOnly} view-only
                  </span>
                  {hidden > 0 && (
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-rose-700">
                      {hidden} hidden
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    disabled={groupBusy === group.key}
                    onClick={() => applyToCategory(group, { canEdit: true, canView: true })}
                  >
                    {groupBusy === group.key ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <PencilLine className="h-3 w-3" aria-hidden="true" />
                    )}
                    Full edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    disabled={groupBusy === group.key}
                    onClick={() => applyToCategory(group, { canEdit: false, canView: true })}
                  >
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    View-only
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px] text-rose-600 hover:text-rose-700"
                    disabled={groupBusy === group.key}
                    onClick={() => applyToCategory(group, { canEdit: false, canView: false })}
                  >
                    <EyeOff className="h-3 w-3" aria-hidden="true" />
                    Hide board
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Per-user table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3 font-medium">Account</th>
                <th className="px-2 py-1.5 font-medium">Category</th>
                <th className="px-2 py-1.5 font-medium">Floors (multi-select)</th>
                <th className="px-2 py-1.5 text-center font-medium">Editing mode</th>
                <th className="px-2 py-1.5 text-center font-medium">Viewing mode</th>
                <th className="py-1.5 pl-3 text-right font-medium">Status</th>
                <th className="py-1.5 pl-2" aria-label="Delete account" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const badge = roleBadge(u);
                const locked = u.role === "ADMIN" || u.id === admin.id;
                return (
                  <tr key={u.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-1.5 pr-3">
                      <span className="font-medium text-slate-700">{u.name}</span>
                      {u.id === admin.id && (
                        <span className="ml-1.5 text-[10px] italic text-slate-400">(you)</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge variant="secondary" className={`${badge.cls} border-0 text-[10px]`}>
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5">
                      {u.role === "NURSE" ? (
                        <FloorsCell
                          user={u}
                          busy={busyId === u.id}
                          onSave={(floors) => patchFloors(u.id, floors, u.name)}
                        />
                      ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <Switch
                        checked={u.canEdit}
                        disabled={locked || busyId === u.id}
                        onCheckedChange={(v) => updateUser(u.id, { canEdit: v }, u.name)}
                        aria-label={`Editing mode for ${u.name}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <Switch
                        checked={u.canView}
                        disabled={locked || busyId === u.id}
                        onCheckedChange={(v) => updateUser(u.id, { canView: v }, u.name)}
                        aria-label={`Viewing mode for ${u.name}`}
                      />
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      {locked ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-600">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          locked
                        </span>
                      ) : !u.canView ? (
                        <span className="text-[10px] font-semibold text-rose-600">board hidden</span>
                      ) : !u.canEdit ? (
                        <span className="text-[10px] font-semibold text-amber-600">view-only</span>
                      ) : (
                        <span className="text-[10px] font-semibold text-emerald-600">full access</span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {!locked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-rose-600 hover:text-rose-700"
                          disabled={busyId === u.id}
                          onClick={() => deleteUser(u.id, u.name)}
                          aria-label={`Delete ${u.name}`}
                          title="Delete account (blocked while it owns logged actions)"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        specialties={specialties}
        onCreate={addUser}
      />
    </Card>
  );
}

/** Multi-select floor assignment for a nurse — chips of assigned floors
 *  (click to remove) plus an add-floor dropdown. Saving patches the account. */
function FloorsCell({
  user,
  busy,
  onSave,
}: {
  user: UserJson;
  busy: boolean;
  onSave: (floors: number[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const floors = user.floors;
  const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(
    (f) => !floors.includes(f)
  );

  const remove = (f: number) => {
    if (floors.length <= 1) return; // never leave a nurse without a floor
    onSave(floors.filter((x) => x !== f));
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {floors.map((f) => (
        <button
          key={f}
          type="button"
          disabled={busy || (floors.length <= 1)}
          onClick={() => remove(f)}
          title={floors.length > 1 ? `Remove floor ${f}` : "A nurse needs at least one floor"}
          className={`rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ${
            busy || floors.length <= 1 ? "opacity-60" : "hover:bg-rose-100 hover:text-rose-700"
          }`}
        >
          {f}
          {floors.length > 1 && <span aria-hidden="true"> ×</span>}
        </button>
      ))}
      {candidates.length > 0 && (
        <Select value="" onValueChange={(v) => { setAdding(false); onSave([...floors, Number(v)]); }}>
          <SelectTrigger
            className="h-6 w-[74px] rounded-full border-dashed border-slate-300 px-2 text-[10px] text-slate-500"
            aria-label={`Add a floor for ${user.name}`}
            disabled={busy}
          >
            <span className="truncate">+ floor</span>
          </SelectTrigger>
          <SelectContent>
            {candidates.map((f) => (
              <SelectItem key={f} value={String(f)}>
                Floor {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  specialties,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  specialties: string[];
  onCreate: (form: {
    name: string;
    role: string;
    floors: string;
    specialty: string;
    subcategory: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("NURSE");
  const [floors, setFloors] = useState("2");
  const [specialty, setSpecialty] = useState(specialties[0] ?? "Internal Medicine");
  const [subcategory, setSubcategory] = useState("MANAGER");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add staff account</DialogTitle>
          <DialogDescription>
            Create an account in any category — it appears in the acting-user switcher immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="new-user-name" className="text-xs font-medium text-slate-600">
              Name
            </label>
            <Input
              id="new-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dalia Sabry"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Category</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NURSE">Nurse (by floor, multi-select)</SelectItem>
                <SelectItem value="PHYSICIAN">Physician (by specialty)</SelectItem>
                <SelectItem value="FINANCE">Financial team</SelectItem>
                <SelectItem value="RECEPTION">Reception (discharge papers)</SelectItem>
                <SelectItem value="UNIVERSAL">Universal (manager / quality)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === "NURSE" && (
            <div className="space-y-1.5">
              <label htmlFor="new-user-floors" className="text-xs font-medium text-slate-600">
                Floors (comma-separated for multi-floor)
              </label>
              <Input
                id="new-user-floors"
                value={floors}
                onChange={(e) => setFloors(e.target.value)}
                placeholder="e.g. 2  or  2, 3"
              />
              <p className="text-[10px] text-slate-400">
                Multi-floor nurses choose the floor they are working on from the board.
              </p>
            </div>
          )}
          {role === "PHYSICIAN" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Specialty</label>
              <Select value={specialty} onValueChange={setSpecialty}>
                <SelectTrigger aria-label="Specialty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {specialties.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {role === "UNIVERSAL" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Subcategory</label>
              <Select value={subcategory} onValueChange={setSubcategory}>
                <SelectTrigger aria-label="Universal subcategory">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="QUALITY">Quality</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="gap-1.5 bg-teal-600 hover:bg-teal-700"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              await onCreate({ name: name.trim(), role, floors, specialty, subcategory });
              setBusy(false);
              setName("");
            }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
