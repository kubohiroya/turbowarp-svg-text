import type { FixedInputEditorOptions, JsonValue } from "@kubohiroya/turbowarp-extension-data-editor";
/** New input only: never run this strict lexical policy over unmodified raw fields. */
export declare function fixedNumber(value: JsonValue): number;
export declare function fixedInputEditorOptions(): readonly FixedInputEditorOptions[];
/** Optional GUI capability; ordinary runtime/composition consumers do not load the editor. */
export declare function registerFixedInputEditors(scratch: unknown, runtime: unknown): (() => void) | undefined;
