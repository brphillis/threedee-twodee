/** Process exit codes. Documented in AGENTS.md and docs/reference/errors.md. */
export const ExitCode = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  INPUT_INVALID: 3,
  GENERATION_FAILED: 4,
  OUTPUT_INVALID: 5,
  PARTIAL_FAILURE: 6,
  ENVIRONMENT: 7,
  CANCELLED: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Sections of docs/guide/troubleshooting.md. Every error and warning names one, and `td2d explain`
 * links to it. A test checks each heading exists and lists its codes.
 */
export const TROUBLESHOOTING_TOPICS = {
  environment: 'Environment and installation',
  usage: 'Commands, projects and ids',
  definitions: 'Asset definitions, presets and palettes',
  models: 'Models, components and imports',
  animation: 'Rigs and animation',
  rendering: 'Rendering',
  pixels: 'Pixel output and validation',
  sheets: 'Sheets and exports',
  batch: 'Caching, batches and cancellation',
  internal: 'Internal errors',
} as const;

export type TroubleshootingTopic = keyof typeof TROUBLESHOOTING_TOPICS;

/** The GitHub-style anchor of a troubleshooting topic heading. */
export function topicAnchor(topic: TroubleshootingTopic): string {
  return TROUBLESHOOTING_TOPICS[topic]
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');
}

export interface ErrorCatalogEntry {
  readonly exit: ExitCodeValue;
  readonly summary: string;
  /** When it happens, in more detail than the summary. */
  readonly detail: string;
  readonly hint: string;
  readonly topic: TroubleshootingTopic;
}

/** Every error code td2d can report, with its exit code, a default hint and where to read more. */
export const ERROR_CATALOG = {
  E_INTERNAL: {
    exit: ExitCode.INTERNAL,
    summary: 'Unexpected internal error.',
    detail:
      'Something td2d does not expect happened, such as an invalid built-in preset or an unhandled exception. It is a bug, not a problem with your files.',
    hint: 'Re-run with --log-level debug and report the output.',
    topic: 'internal',
  },
  E_USAGE: {
    exit: ExitCode.USAGE,
    summary: 'Invalid command usage.',
    detail:
      'An unknown command, option or argument, an option value out of range, a malformed frame filter, a busy port for the viewer, or a combination of options that cannot work together.',
    hint: 'Run `td2d <command> --help`.',
    topic: 'usage',
  },
  E_PROJECT_NOT_FOUND: {
    exit: ExitCode.USAGE,
    summary: 'No td2d project was found.',
    detail:
      'Commands look for td2d.project.json in the current directory and its parents, or in the directory --project names.',
    hint: 'Run `td2d init <dir>` to create one, or pass --project <dir>.',
    topic: 'usage',
  },
  E_PROJECT_EXISTS: {
    exit: ExitCode.USAGE,
    summary: 'A td2d project already exists here.',
    detail: '`td2d init` found a td2d.project.json in the target directory.',
    hint: 'Choose another directory.',
    topic: 'usage',
  },
  E_INIT_CONFLICT: {
    exit: ExitCode.USAGE,
    summary: 'Creating the project would overwrite existing files.',
    detail: '`td2d init` never replaces files; the details list the ones in the way.',
    hint: 'Choose an empty directory or move the listed files.',
    topic: 'usage',
  },
  E_ASSET_NOT_FOUND: {
    exit: ExitCode.USAGE,
    summary: 'The asset does not exist.',
    detail:
      'No assets/<id>/asset.json (or asset script) exists for the id. Ids are paths below assets/, such as props/crate.',
    hint: 'Run `td2d asset list` to see asset ids.',
    topic: 'usage',
  },
  E_ASSET_EXISTS: {
    exit: ExitCode.USAGE,
    summary: 'An asset with this id already exists.',
    detail: '`td2d asset create` and `td2d asset emit` do not replace an existing asset.json.',
    hint: 'Choose another id or edit the existing asset.json.',
    topic: 'usage',
  },
  E_NOT_GENERATED: {
    exit: ExitCode.USAGE,
    summary: 'The asset has not been generated yet.',
    detail:
      'The command reads build/<id>/ (inspect, preview, compare, sheet, export, the viewer), and it has no manifest yet.',
    hint: 'Run `td2d generate <id>` first.',
    topic: 'usage',
  },
  E_SCHEMA_NOT_FOUND: {
    exit: ExitCode.USAGE,
    summary: 'Unknown schema name.',
    detail: '`td2d schema <name>` takes one of the document names `td2d schema --list` prints.',
    hint: 'Run `td2d schema --list` to see schema names.',
    topic: 'usage',
  },
  E_TEMPLATE_NOT_FOUND: {
    exit: ExitCode.USAGE,
    summary: 'Unknown template name.',
    detail: '`td2d init --template` and `td2d asset create --template` take a template that `td2d describe` lists.',
    hint: 'Run `td2d describe` to list templates.',
    topic: 'usage',
  },
  E_JSON_PARSE: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A file is not valid JSON.',
    detail:
      'td2d reads plain JSON: no comments, no trailing commas, double-quoted keys. The error names the file, line and column.',
    hint: 'Fix the JSON syntax at the reported line and column. Comments and trailing commas are not allowed.',
    topic: 'definitions',
  },
  E_PROJECT_INVALID: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'td2d.project.json failed validation.',
    detail: 'The project file has an unknown key, a wrong type or a missing field. Each issue gives its path.',
    hint: 'Run `td2d schema project` to see the schema.',
    topic: 'definitions',
  },
  E_ASSET_INVALID: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'An asset definition failed validation.',
    detail:
      'The asset has an unknown key, a wrong type, a reference to a missing material, bone or clip, or settings that contradict each other. Each issue gives its file and path, such as model.parts[1].size.',
    hint: 'Run `td2d schema asset` to see the schema.',
    topic: 'definitions',
  },
  E_PRESET_NOT_FOUND: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A referenced preset does not exist.',
    detail:
      "A camera, lighting, pixel, sheet, export or rig setting names a preset that is neither built in nor in the project's presets/ directories.",
    hint: 'Run `td2d describe` to list presets.',
    topic: 'definitions',
  },
  E_PRESET_INVALID: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A preset file failed validation.',
    detail:
      "A file under presets/<kind>/ does not match that kind's schema. `td2d validate` lists every problem with its file.",
    hint: 'Run `td2d schema <kind>-preset` to see the schema.',
    topic: 'definitions',
  },
  E_PALETTE_NOT_FOUND: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A referenced palette does not exist.',
    detail:
      "`pixel.palette` names a palette that is neither built in nor in the project's palettes/ directories. Automatic palettes are written auto:<n>.",
    hint: 'Run `td2d describe` to list palettes.',
    topic: 'definitions',
  },
  E_PALETTE_INVALID: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A palette file failed validation.',
    detail: 'A file under palettes/ does not match the palette schema: colours must be #rrggbb and names unique.',
    hint: 'Run `td2d schema palette` to see the schema.',
    topic: 'definitions',
  },
  E_PATH_OUTSIDE_PROJECT: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A path points outside the project root.',
    detail:
      'td2d reads and writes only inside the project. A path with ".." segments, an absolute path, or a symlink that leads out is refused.',
    hint: 'Use paths relative to the project root without ".." segments or symlinks that leave the project.',
    topic: 'definitions',
  },
  E_OUTPUT_DIR_NOT_EMPTY: {
    exit: ExitCode.USAGE,
    summary: 'The output directory contains files that td2d did not write.',
    detail:
      'Commands that write to a directory you name (`td2d render --out`) only replace directories td2d created, which carry a .td2d-output marker.',
    hint: 'Choose an empty directory, or one td2d created (it contains a .td2d-output marker).',
    topic: 'usage',
  },
  E_MODEL_INVALID: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A model file could not be read.',
    detail:
      'The GLB given to `td2d render --glb` is missing, unreadable, not binary glTF, or failed to load in the renderer.',
    hint: 'Check that the file is a binary glTF (.glb) and opens in a glTF viewer.',
    topic: 'models',
  },
  E_PART_NOT_MANIFOLD: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A CSG operand is not a closed solid.',
    detail:
      'union, subtract and intersect need closed, watertight operands. Planes, lathes with open ends, and most imports are open surfaces.',
    hint: 'Make each operand a closed shape (box, sphere, cylinder, capsule, or a lathe with closed ends), or place the parts in a group instead of combining them.',
    topic: 'models',
  },
  E_COMPONENT_NOT_FOUND: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A referenced component does not exist.',
    detail: "A part of type component names a file that is not in the project's components/ directories.",
    hint: 'Add components/<name>.json, or run `td2d describe` to list components.',
    topic: 'models',
  },
  E_COMPONENT_INVALID: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'A component file or its parameters are invalid.',
    detail:
      'The component file does not match its schema, a parameter is missing or has the wrong type, or a ${...} expression fails. Issues give the path inside the component.',
    hint: 'Run `td2d schema component` to see the component format.',
    topic: 'models',
  },
  E_COMPONENT_CYCLE: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'Components include each other in a loop, or nest more than 8 deep.',
    detail:
      'Expanding components found one that includes itself, directly or through others, or nesting deeper than 8 levels.',
    hint: 'Break the loop so no component includes itself, directly or indirectly.',
    topic: 'models',
  },
  E_IMPORT_FAILED: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'An imported model could not be read.',
    detail: 'A part of type import names a file that is missing, larger than 50 MB, or not a valid GLB.',
    hint: 'Check the src path, relative to the asset directory, and that the file is a valid GLB under 50 MB.',
    topic: 'models',
  },
  E_MODEL_TOO_COMPLEX: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'The model has more triangles than the limit.',
    detail:
      'The built model has more than 50,000 triangles. Sprites cannot show that detail, and rendering slows down.',
    hint: 'Lower segment counts, simplify imports, or remove hidden detail. The limit is 50,000 triangles.',
    topic: 'models',
  },
  E_SCRIPT_FAILED: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'An asset script failed or printed an invalid definition.',
    detail:
      '`td2d asset emit` ran the script in a child process and it threw, timed out, or produced something that is not an asset definition.',
    hint: 'Run the script with Node to see its error. Its default export must be an asset definition or a function returning one.',
    topic: 'definitions',
  },
  E_SCRIPT_PERMISSION: {
    exit: ExitCode.INPUT_INVALID,
    summary: 'An asset script tried to do something asset scripts may not do.',
    detail:
      "td2d asset emit runs scripts with Node's permission model: they may read the project and the packages they import, and nothing else. Writing files, reading outside those directories, starting processes or workers, and loading native addons are refused, and nothing is written.",
    hint: 'Compute the definition and return it from the default export; td2d writes it.',
    topic: 'definitions',
  },
  E_GENERATION_FAILED: {
    exit: ExitCode.GENERATION_FAILED,
    summary: 'Generation failed.',
    detail:
      'A stage could not finish for a reason other than invalid input: the built or rigged model failed glTF validation, geometry could not be merged, or a sheet needs more room than sheet.maxSize.',
    hint: 'Inspect the error details, fix the asset, and run the command again.',
    topic: 'rendering',
  },
  E_PARTIAL_PLAN: {
    exit: ExitCode.USAGE,
    summary: 'A frame filter leaves out frames that are not in the cache, so the sheet cannot be completed.',
    detail:
      '`td2d generate --frames`, `--clips` or `--directions` renders only the matching samples and takes the rest from the cache; some of the rest have never been rendered.',
    hint: 'Drop --frames, --clips or --directions once to render everything, then filter again.',
    topic: 'batch',
  },
  E_BACKEND_CRASHED: {
    exit: ExitCode.GENERATION_FAILED,
    summary: 'The headless browser crashed during rendering, and again after a restart.',
    detail:
      'The render page crashed or the browser disconnected twice for the same asset. Running out of memory is the usual cause.',
    hint: 'Run `td2d doctor`, then retry. Re-run with --log-level debug for browser output.',
    topic: 'rendering',
  },
  E_BATCH_FAILED: {
    exit: ExitCode.GENERATION_FAILED,
    summary: 'An asset in the batch failed, so the batch stopped.',
    detail:
      'Without --continue-on-error, a batch stops at the first failure. The report lists the failure and the assets that did not run.',
    hint: 'Read build/batch-report.json. Use --continue-on-error to finish the other assets, then --resume to retry.',
    topic: 'batch',
  },
  E_ASSET_TIMEOUT: {
    exit: ExitCode.GENERATION_FAILED,
    summary: 'An asset took longer than --timeout and was stopped.',
    detail:
      'With --timeout, each asset has a wall-clock limit. The asset that ran over is stopped and fails; a batch goes on to the next asset as it does for any failure.',
    hint: 'Raise --timeout, or render fewer directions or frames while iterating.',
    topic: 'batch',
  },
  E_RENDER_FAILED: {
    exit: ExitCode.GENERATION_FAILED,
    summary: 'Rendering failed.',
    detail: 'The headless browser reported an error while drawing frames, or a render step timed out.',
    hint: 'Re-run with --log-level debug to see browser console output.',
    topic: 'rendering',
  },
  E_VALIDATION_FAILED: {
    exit: ExitCode.OUTPUT_INVALID,
    summary: 'Generated output failed validation.',
    detail:
      'A check in validation.json failed, or with --strict a check warned. The sprites and sheets were still written so you can look at them.',
    hint: 'Read validation.json for the failing checks.',
    topic: 'pixels',
  },
  E_BATCH_PARTIAL: {
    exit: ExitCode.PARTIAL_FAILURE,
    summary: 'Some assets in the batch failed.',
    detail:
      'With --continue-on-error (or several ids to generate), every asset ran and at least one failed. The others are written.',
    hint: 'Read the batch report for per-asset errors.',
    topic: 'batch',
  },
  E_ENVIRONMENT: {
    exit: ExitCode.ENVIRONMENT,
    summary: 'The environment is missing something td2d needs.',
    detail: '`td2d doctor` found a failing check, such as a project directory td2d cannot write to.',
    hint: 'Run `td2d doctor` for details.',
    topic: 'environment',
  },
  E_NODE_VERSION: {
    exit: ExitCode.ENVIRONMENT,
    summary: 'This Node.js version is not supported.',
    detail: 'td2d needs Node.js 24 or newer for type stripping, recursive file watching and the permission model.',
    hint: 'Install Node.js 24 or newer.',
    topic: 'environment',
  },
  E_BROWSER_MISSING: {
    exit: ExitCode.ENVIRONMENT,
    summary: 'The headless browser used for rendering is not installed.',
    detail: "Rendering runs in Playwright's headless Chromium, which is downloaded separately from npm packages.",
    hint: 'Run `td2d doctor --fix` to install it.',
    topic: 'environment',
  },
  E_BACKEND_UNAVAILABLE: {
    exit: ExitCode.ENVIRONMENT,
    summary: 'The render backend cannot run on this machine.',
    detail:
      'The browser failed to start, WebGL2 is unavailable, the render harness is missing or a different version, or the backend id is unknown.',
    hint: 'Run `td2d doctor` for details.',
    topic: 'environment',
  },
  E_NATIVE_MODULE: {
    exit: ExitCode.ENVIRONMENT,
    summary: 'A native module failed to load.',
    detail:
      'sharp or the manifold geometry module did not load, usually because dependencies were installed for another platform or architecture.',
    hint: 'Reinstall dependencies for this platform and run `td2d doctor`.',
    topic: 'environment',
  },
  E_CANCELLED: {
    exit: ExitCode.CANCELLED,
    summary: 'The operation was cancelled.',
    detail:
      'SIGINT (Ctrl+C) or SIGTERM arrived. td2d stopped its browser and workers and left no partial outputs; the cache keeps what finished.',
    hint: 'Run the command again.',
    topic: 'batch',
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES: readonly ErrorCode[] = Object.keys(ERROR_CATALOG) as ErrorCode[];

export interface WarningCatalogEntry {
  readonly summary: string;
  readonly hint: string;
  readonly topic: TroubleshootingTopic;
}

/** Warning codes. Warnings never change the exit code, except that --strict fails on validation warnings. */
export const WARNING_CATALOG = {
  W_OPACITY_THRESHOLDED: {
    summary: 'A material has opacity below 1, but the pixel stage makes alpha binary.',
    hint: 'Use a solid colour, or dither, instead of partial opacity.',
    topic: 'pixels',
  },
  W_UNUSED_MATERIAL: {
    summary: 'A material is defined but no part uses it.',
    hint: 'Remove the material, or check the part that should use it for a misspelt name.',
    topic: 'definitions',
  },
  W_PRESET_SHADOWS_BUILTIN: {
    summary: 'A project preset has the same name as a built-in preset and replaces it.',
    hint: 'Rename the project preset if the replacement is not intended.',
    topic: 'definitions',
  },
  W_NO_ASSETS: {
    summary: 'The project has no assets.',
    hint: 'Run `td2d asset create <id> --template box`.',
    topic: 'usage',
  },
  W_HARDWARE_RENDERER: {
    summary: 'Rendering is not using the SwiftShader software rasteriser, so output may differ between machines.',
    hint: 'Run `td2d doctor`; td2d launches Chromium with SwiftShader unless something overrides its flags.',
    topic: 'rendering',
  },
  W_BLANK_FRAME: {
    summary: 'A rendered frame has no opaque pixels. The model may be outside the camera view.',
    hint: 'Check the model is near the origin and above y = 0, and that pixelsPerUnit is not far too small.',
    topic: 'rendering',
  },
  W_FRAME_CLIPPED: {
    summary: 'A rendered frame has opaque pixels on its edge, so the model is probably cut off.',
    hint: 'Lower pixelsPerUnit (or set it to "auto"), enlarge the frame, or shrink the model.',
    topic: 'rendering',
  },
  W_VALIDATOR_UNAVAILABLE: {
    summary: 'The glTF validator could not run, so the built model was not validated.',
    hint: 'Reinstall dependencies; the model is still built and rendered.',
    topic: 'environment',
  },
  W_OUTPUT_CHECK: {
    summary: 'A generated sprite failed a non-fatal check. See validation.json.',
    hint: 'Read validation.json for the check and the frames it names.',
    topic: 'pixels',
  },
  W_MODEL_OUT_OF_FRAME: {
    summary: 'The model is larger than the frame in some direction, so sprites will be cut off.',
    hint: 'Lower pixelsPerUnit (or set it to "auto"), enlarge the frame, or shrink the model.',
    topic: 'models',
  },
  W_MODEL_BELOW_GROUND: {
    summary: 'Part of the model is below y = 0, the ground.',
    hint: 'Raise the parts so their base sits at y = 0; parts are centred on their position.',
    topic: 'models',
  },
  W_TRIANGLE_BUDGET: {
    summary: 'The model has more than 20,000 triangles, which slows rendering without adding visible detail.',
    hint: 'Lower segment counts or simplify imports.',
    topic: 'models',
  },
  W_DEGENERATE_TRIANGLES: {
    summary: 'The model has zero-area triangles.',
    hint: 'Look for parts with a zero size or zero radius.',
    topic: 'models',
  },
  W_OPEN_MESH: {
    summary: 'A part is not a closed surface, so it may show holes or render inside-out faces.',
    hint: 'Prefer closed shapes. A plane or an open lathe is fine where its back is never seen.',
    topic: 'models',
  },
  W_COMPOSITION_GROUND: {
    summary: 'A sprite does not reach the ground line, so the model floats above its pivot.',
    hint: 'Put the model\'s base at y = 0, or set camera.groundMargin to "auto".',
    topic: 'pixels',
  },
  W_COMPOSITION_EDGE: {
    summary: 'A sprite touches the frame edge, so it is probably cut off.',
    hint: 'Lower pixelsPerUnit (or set it to "auto"), or enlarge the frame.',
    topic: 'pixels',
  },
  W_INDEXED_UNAVAILABLE: {
    summary:
      'An indexed PNG was requested but the image needs more than 256 palette entries, so it was written as RGBA.',
    hint: 'Set a palette (fixed or auto:<n>) so sprites use at most 256 colours.',
    topic: 'pixels',
  },
  W_CLIP_FRAME_PERIOD: {
    summary: 'A clip duration is not a whole number of frames, so it plays at a slightly different frame rate.',
    hint: 'Make duration times fps a whole number.',
    topic: 'animation',
  },
  W_CLIP_BONE_LIMIT: {
    summary: 'A clip turns a bone further than the limits declared in the rig.',
    hint: "Reduce the rotation in the named key, or widen the bone's limits in the rig.",
    topic: 'animation',
  },
  W_CLIP_FOOT_CONTACT: {
    summary: 'In a walk-cycle clip the feet leave the ground or sink into it by more than a pixel.',
    hint: 'Set the walk-cycle bob the warning suggests.',
    topic: 'animation',
  },
  W_BACKEND_RESTARTED: {
    summary: 'The headless browser crashed (E_BACKEND_CRASHED) and was restarted; the retry succeeded.',
    hint: 'Outputs are complete. Repeated restarts usually mean too little memory: lower --concurrency.',
    topic: 'rendering',
  },
  W_CACHE_PRUNED: {
    summary: 'The cache grew past its size limit, so the least recently used entries were removed.',
    hint: 'Raise cache.maxSize in td2d.project.json if entries you need keep being removed.',
    topic: 'batch',
  },
  W_MEMORY_HIGH: {
    summary: "td2d's memory use passed the warning level during a stage.",
    hint: 'Lower td2d batch --concurrency or render fewer frames at once. TD2D_MEMORY_WARN_MB sets the level.',
    topic: 'batch',
  },
  W_PALETTE_PER_CLIP: {
    summary: 'Each clip has its own automatic palette, so colours can jump where one clip hands over to another.',
    hint: 'Use paletteScope "asset" (the default) unless clips never play next to each other.',
    topic: 'pixels',
  },
} as const satisfies Record<string, WarningCatalogEntry>;

export type WarningCode = keyof typeof WARNING_CATALOG;

export function exitCodeFor(code: ErrorCode): ExitCodeValue {
  return ERROR_CATALOG[code].exit;
}
