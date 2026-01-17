import type { Schema, Relationship } from "./model";

/**
 * Classification of a relationship for ownership purposes.
 */
export type RelationshipKind = "composition" | "reference";

/**
 * A classified relationship with ownership information.
 */
export interface ClassifiedRelationship {
	readonly relationship: Relationship;
	readonly kind: RelationshipKind;
	/** True if this is the dominant composition (determines nesting location) */
	readonly isDominant: boolean;
}

/**
 * An edge in the ownership tree (parent -> child).
 */
export interface OwnershipEdge {
	readonly parentTable: string;
	readonly childTable: string;
	readonly relationship: Relationship;
	/** FK columns on the child that reference the parent */
	readonly foreignKeyColumns: readonly string[];
}

/**
 * Represents the ownership tree derived from a schema.
 * 
 * The ownership tree determines:
 * - Which tables are roots (no dominant parent)
 * - Where each table appears nested in the JSON hierarchy
 * - Which FK columns are implicit (from nesting) vs explicit (references)
 */
export interface OwnershipTree {
	/** Tables with no dominant parent - they appear at root level */
	readonly roots: readonly string[];
	/** Get children that nest under this table */
	getChildren(tableName: string): readonly OwnershipEdge[];
	/** Get the dominant parent of a table (if any) */
	getDominantParent(tableName: string): OwnershipEdge | undefined;
	/** Get all classified relationships for the schema */
	readonly classifiedRelationships: readonly ClassifiedRelationship[];
}

/**
 * Build an ownership tree from a schema.
 * 
 * Algorithm:
 * 1. Classify relationships (CASCADE → composition, others → reference)
 * 2. For tables with multiple incoming compositions, pick one as dominant
 * 3. Self-references are always treated as references (not compositions)
 */
export function buildOwnershipTree(schema: Schema): OwnershipTree {
	const classified: ClassifiedRelationship[] = [];
	
	// Group incoming compositions by target table
	const incomingCompositions = new Map<string, Relationship[]>();
	
	for (const rel of schema.relationships) {
		const kind = classifyRelationship(rel);
		
		if (kind === "composition") {
			const existing = incomingCompositions.get(rel.fromTable) ?? [];
			existing.push(rel);
			incomingCompositions.set(rel.fromTable, existing);
		} else {
			classified.push({ relationship: rel, kind, isDominant: false });
		}
	}
	
	// For each table, pick dominant composition (if multiple)
	const dominantParent = new Map<string, Relationship>();
	
	for (const [childTable, compositions] of incomingCompositions) {
		if (compositions.length === 0) continue;
		
		// Pick dominant using heuristics
		const dominant = selectDominant(compositions, schema);
		dominantParent.set(childTable, dominant);
		
		for (const rel of compositions) {
			classified.push({
				relationship: rel,
				kind: "composition",
				isDominant: rel === dominant,
			});
		}
	}
	
	// Build children map (for getChildren)
	const childrenMap = new Map<string, OwnershipEdge[]>();
	for (const [childTable, rel] of dominantParent) {
		const edge: OwnershipEdge = {
			parentTable: rel.toTable,
			childTable,
			relationship: rel,
			foreignKeyColumns: [...rel.fromColumns],
		};
		
		const existing = childrenMap.get(rel.toTable) ?? [];
		existing.push(edge);
		childrenMap.set(rel.toTable, existing);
	}
	
	// Find root tables (tables with no dominant parent)
	const roots: string[] = [];
	for (const tableName of schema.tables.keys()) {
		if (!dominantParent.has(tableName)) {
			roots.push(tableName);
		}
	}
	roots.sort(); // Deterministic order
	
	return {
		roots,
		getChildren(tableName: string): readonly OwnershipEdge[] {
			return childrenMap.get(tableName) ?? [];
		},
		getDominantParent(tableName: string): OwnershipEdge | undefined {
			const rel = dominantParent.get(tableName);
			if (!rel) return undefined;
			return {
				parentTable: rel.toTable,
				childTable: tableName,
				relationship: rel,
				foreignKeyColumns: [...rel.fromColumns],
			};
		},
		classifiedRelationships: classified,
	};
}

/**
 * Classify a relationship based on ON DELETE action.
 */
function classifyRelationship(rel: Relationship): RelationshipKind {
	// Self-references are always references (avoid cycles)
	if (rel.fromTable === rel.toTable) {
		return "reference";
	}
	
	// CASCADE implies ownership/composition
	if (rel.onDelete === "CASCADE") {
		return "composition";
	}
	
	// Everything else is a reference
	return "reference";
}

/**
 * Select the dominant composition when a table has multiple incoming compositions.
 * 
 * Heuristics (in order):
 * 1. Prefer single-column FK over composite
 * 2. Alphabetically first parent table (deterministic fallback)
 */
function selectDominant(compositions: Relationship[], _schema: Schema): Relationship {
	// Sort by: fewer FK columns first, then alphabetical parent
	const sorted = [...compositions].sort((a, b) => {
		// Prefer single-column FK
		if (a.fromColumns.length !== b.fromColumns.length) {
			return a.fromColumns.length - b.fromColumns.length;
		}
		// Alphabetical fallback
		return a.toTable.localeCompare(b.toTable);
	});
	
	return sorted[0];
}
