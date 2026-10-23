export type Light = "green" | "yellow" | "red";

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  department: string | null;
  approved: boolean;
  is_game_part: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  start_date: string | null;
  pm_id: string | null;
  pm_status: Light | null;
  pm_memo: string | null;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  project_id: string;
  sort_order: number;
  name: string;
  department: string | null;
  related_departments: string[];
  description: string | null;
  plan_start: string | null;
  plan_end: string | null;
  actual_start: string | null;
  expected_end: string | null;
  actual_end: string | null;
  progress: number;
  pm_status: Light | null;
  issue: string | null;
  next_action: string | null;
  assignee: string | null;
  needs_check: boolean;
  skipped: boolean;
  updated_at: string;
  updated_by: string | null;
}

export type LogKind = "memo" | "issue" | "decision" | "change";

export interface StageLog {
  id: string;
  project_id: string;
  stage_id: string | null;
  stage_name: string | null;
  kind: LogKind;
  body: string;
  author_id: string | null;
  created_at: string;
}

export interface TemplateStage {
  name: string;
  department?: string | null;
  related_departments?: string[];
  description?: string | null;
  start_week?: number | null;
  weeks?: number | null;
  skipped?: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  stages: TemplateStage[];
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "editor";
  added_at: string;
}

export interface Department {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Invite {
  email: string;
  name: string | null;
  department: string | null;
  is_game_part: boolean;
  is_admin: boolean;
  project_ids: string[];
  invited_by: string | null;
  created_at: string;
  used_at: string | null;
  user_id: string | null;
}
