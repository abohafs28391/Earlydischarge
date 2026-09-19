"use client";

import { UsersRound } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserJson } from "@/lib/workflow";

interface UserSwitcherProps {
  users: UserJson[];
  value: string | null;
  onChange: (id: string) => void;
}

/** Simulated sign-in: pick who is acting. Groups mirror the full user
 *  taxonomy — nurses by floor, physicians by specialty, financial team,
 *  universal (managers & quality) and admins. */
export function UserSwitcher({ users, value, onChange }: UserSwitcherProps) {
  const admins = users.filter((u) => u.role === "ADMIN");
  const managers = users.filter((u) => u.role === "UNIVERSAL" && u.subcategory === "MANAGER");
  const quality = users.filter((u) => u.role === "UNIVERSAL" && u.subcategory === "QUALITY");
  const nurses = users.filter((u) => u.role === "NURSE");
  const physicians = users.filter((u) => u.role === "PHYSICIAN");
  const finance = users.filter((u) => u.role === "FINANCE");
  const reception = users.filter((u) => u.role === "RECEPTION");

  return (
    <div className="flex items-center gap-2">
      <UsersRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger
          className="h-9 w-[240px] bg-white sm:w-[280px]"
          aria-label="Acting as user (role switcher)"
        >
          <SelectValue placeholder="Acting as…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Admins</SelectLabel>
            {admins.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Universal — managers</SelectLabel>
            {managers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Universal — quality</SelectLabel>
            {quality.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Nurses — by floor</SelectLabel>
            {nurses.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name} · Floor{u.floors.length > 1 ? `s ${u.floors.join(" & ")}` : ` ${u.floors[0] ?? "—"}`}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Physicians — by specialty</SelectLabel>
            {physicians.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name} · {u.specialty}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Financial team</SelectLabel>
            {finance.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Reception</SelectLabel>
            {reception.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
