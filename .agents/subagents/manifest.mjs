// Subagent manifest (Authored: `hi` writes it once and never overwrites it).
// Edit agents and capability packs here, then run `hi update` to rebuild the
// Claude, Codex, Cursor, and OpenCode agent files. Tailoring guidance for this
// repository: .agents/subagents/manifest.prompt.md.
const capabilityPacks = {
  "review-core": {
    description:
      "Cross-cutting review, simplification, and architecture-friction analysis for changed code.",
    skills: ["simplify", "codebase-design", "improve-codebase-architecture"],
  },
  "workflow-planning": {
    description: "Default workflow planning pack for spec discovery, spec review, and plan review.",
    skills: [
      "create-spec",
      "create-plan",
      "parallel-research",
      "swarm-planner",
      "tdd",
      "make-tsuite",
      "codebase-design",
      "simplify",
    ],
  },
  "workflow-requirements": {
    description: "Default workflow requirements pack for grill synthesis and backlog shaping.",
    skills: ["requirements-phase", "requirements-grill", "write-backlog"],
  },
  "workflow-review": {
    description: "Default workflow review pack for readonly artifact checks.",
    skills: ["review-phase", "simplify"],
  },
};

const skillActivationInstructions = [
  "Before planning or editing, read every file in `guidanceFiles` for this role.",
  "In each final docs/workspace AGENTS.md, read its `## Skills` table. When assigned work matches a row's trigger, treat that row's skill as mandatory.",
  "Activate a selected skill by opening its installed `.agents/skills/<skill-id>/SKILL.md`, reading the workflow/checklist needed for the assigned task, and applying it before edits.",
  "When the task writes or edits root/scoped AGENTS.md, prompt specs or handoffs, or subagent templates/instructions, activate `writing-for-agents` from `.agents/skills/writing-for-agents/SKILL.md` before that authoring branch.",
  "Before completing release-bearing work, run the repository's semantic release classification. Baseline changes require a reviewed non-empty `BASELINE_CHANGELOG.md`; npm changes require a version bump and matching reviewed non-empty `CHANGELOG.md`; mixed changes require both.",
  "When a skill listed in scoped guidance is also present in this role's `skills`, explicitly mention in the worker's reasoning or handoff that it was used.",
  "If the task touches multiple owned or related scopes, inspect each scope's nearest AGENTS.md and activate the union of relevant skills.",
  "Do not rely on role name or inherited context alone; scoped AGENTS.md skill routing is part of the task contract.",
];

const reviewActivationInstructions = [
  ...skillActivationInstructions,
  "Stay read-only unless the parent explicitly asks for fixes.",
  "Lead with findings, sorted by severity, with precise file/line references.",
  "Use `simplify` to evaluate whether recently changed code can be clearer, smaller, or less stateful.",
  "Use `improve-codebase-architecture` only when the review reveals cross-module coupling, shallow-module sprawl, testability friction, or AI-navigation problems worth surfacing.",
];

const agents = [
  {
    activationInstructions: reviewActivationInstructions,
    boundaries: [
      "Review first: identify concrete defects, behavioral risks, missing tests, and simplification opportunities before summarizing.",
      "Do not edit files unless the parent explicitly assigns implementation after the review.",
      "Keep architecture notes grounded in observed code friction; return candidate refactors or follow-up RFC recommendations instead of speculative rewrites.",
      "If the task asks for feature work rather than review, tell the parent to use the relevant implementation specialist.",
    ],
    description:
      "Use for cross-cutting code review centered on bugs, regressions, simplification opportunities, architecture friction, and review-ready findings across changed code.",
    guidanceFiles: ["AGENTS.md"],
    name: "code-review",
    ownedPaths: ["**/*"],
    packs: ["review-core"],
    skills: ["simplify", "improve-codebase-architecture"],
  },
  {
    activationInstructions: [
      ...skillActivationInstructions,
      "Stay read-only and keep the pass bounded to discovery evidence.",
      "Return evidence, contradictions, overlapping work, and open questions; do not choose product direction or design the solution.",
      "Use `parallel-research` only when the evidence can be split across independent sources.",
    ],
    boundaries: [
      "Do not edit files.",
      "Do not write specs, plans, or backlog items.",
      "Do not resolve open questions; name what the parent must decide.",
    ],
    description:
      "Use for bounded readonly orientation before spec or plan writing: gather evidence, contradictions, overlapping work, and open questions without solution design.",
    guidanceFiles: ["AGENTS.md"],
    name: "planning-discovery",
    ownedPaths: ["**/*"],
    packs: ["workflow-planning"],
    skills: ["parallel-research", "create-spec"],
  },
  {
    activationInstructions: [
      ...skillActivationInstructions,
      "Stay read-only and treat requirements artifacts as evidence, not permission to invent scope.",
      "Separate accepted, rejected, superseded, parked, and unresolved decisions.",
      "Report whether backlog writing is blocked and name the exact blocking branches.",
    ],
    boundaries: [
      "Do not interview the user unless the parent delegates one exact question.",
      "Do not write or sync backlog items.",
      "Do not silently convert parked or unresolved scope into accepted backlog content.",
    ],
    description:
      "Use for readonly compression of grill/status/log artifacts into accepted, rejected, superseded, parked, and unresolved decisions.",
    guidanceFiles: ["AGENTS.md"],
    name: "requirements-synthesizer",
    ownedPaths: ["**/*"],
    packs: ["workflow-requirements"],
    skills: ["requirements-phase", "requirements-grill", "write-backlog"],
  },
  {
    activationInstructions: [
      ...skillActivationInstructions,
      "Use `write-backlog` and the backlog model to derive module -> epic -> story shape from locked direction only.",
      "Keep parked or unresolved scope as deferred notes, not silent backlog content.",
      "Return a draft hierarchy and provider payload considerations; do not sync externally.",
    ],
    boundaries: [
      "Draft only unless the parent explicitly assigns file edits.",
      "Do not call provider APIs or create tracker items.",
      "Do not add implementation-task detail to product-facing epic or story bodies.",
    ],
    description:
      "Use for draft-only module, epic, and story shaping from closed requirements; provider sync and final backlog decisions stay with the parent.",
    guidanceFiles: ["AGENTS.md"],
    name: "backlog-shaper",
    ownedPaths: ["**/*"],
    packs: ["workflow-requirements"],
    skills: ["requirements-phase", "write-backlog"],
  },
  {
    activationInstructions: [
      ...reviewActivationInstructions,
      "Use `create-spec` as the spec contract and keep findings in the problem space.",
      "Check that the draft maps to accepted requirements and does not invent unaccepted scope.",
      "Return actionable spec findings only; do not rewrite the spec unless the parent asks.",
    ],
    boundaries: [
      "Do not edit files unless explicitly assigned.",
      "Do not add implementation design to the spec.",
      "Do not approve vague acceptance criteria without naming the gap.",
    ],
    description:
      "Use for readonly review of drafted specs before user review, checking invented requirements, contradictions, missing constraints, and vague acceptance criteria.",
    guidanceFiles: ["AGENTS.md"],
    name: "spec-reviewer",
    ownedPaths: ["**/*"],
    packs: ["workflow-planning", "workflow-review"],
    skills: ["create-spec", "review-phase", "simplify"],
  },
  {
    activationInstructions: [
      ...reviewActivationInstructions,
      "Use `create-plan`, `swarm-planner`, `tdd`, and `codebase-design` as the plan contract.",
      "Check dependency graph, task size, write-scope overlap, RED targets, codebase design notes, validation commands, review modes, and assigned skills.",
      "Return specific plan findings; do not implement the plan.",
    ],
    boundaries: [
      "Do not edit files unless explicitly assigned.",
      "Do not spawn implementation workers.",
      "Do not treat `swarm-planner` itself as the subagent archetype; review the parent-owned plan output.",
    ],
    description:
      "Use for readonly review of plans before yielding, checking dependencies, ordering, invalid parallelism, unsafe write overlap, RED targets, validation, and assigned skills.",
    guidanceFiles: ["AGENTS.md"],
    name: "plan-reviewer",
    ownedPaths: ["**/*"],
    packs: ["workflow-planning", "workflow-review"],
    skills: ["create-plan", "swarm-planner", "tdd", "codebase-design", "simplify"],
  },
];

export { agents, capabilityPacks };
