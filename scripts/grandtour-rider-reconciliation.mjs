const TRACKED_FIELDS = [
  "team_id",
  "display_name",
  "normalized_name",
  "bib_number",
  "nationality",
  "country",
];

export function stageSpecificBibPatch(sourceEntry, stageId) {
  if (sourceEntry.stage_id !== stageId || sourceEntry.bib_number === null
    || sourceEntry.bib_number === undefined || String(sourceEntry.bib_number).trim() === "") {
    return {};
  }
  const bibNumber = Number(sourceEntry.bib_number);
  if (!Number.isInteger(bibNumber) || bibNumber <= 0) {
    throw new Error(`Stage-specific bib number must be a positive integer: ${sourceEntry.bib_number}`);
  }
  return { bib_number: bibNumber };
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function key(...parts) {
  return parts.map((part) => part ?? "<null>").join("|");
}

function groupBy(rows, keyForRow) {
  const grouped = new Map();
  for (const row of rows) {
    const rowKey = keyForRow(row);
    grouped.set(rowKey, [...(grouped.get(rowKey) ?? []), row]);
  }
  return grouped;
}

export function summarizeRiderSource(riders) {
  const bibGroups = groupBy(
    riders.filter((rider) => rider.bib_number !== null && rider.bib_number !== undefined),
    (rider) => key(rider.grand_tour_id, rider.team_id, rider.bib_number),
  );
  return {
    missingBibNumbers: riders.filter((rider) => rider.bib_number === null || rider.bib_number === undefined).length,
    duplicateBibNumbersPerTourTeam: [...bibGroups.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([groupKey, matches]) => ({
        key: groupKey,
        riderIds: matches.map((rider) => rider.id),
      })),
  };
}

export function planRiderReconciliation(incomingRiders, existingRiders) {
  const existingById = new Map(existingRiders.map((rider) => [rider.id, rider]));
  const existingByNormalizedName = groupBy(
    existingRiders,
    (rider) => key(rider.grand_tour_id, rider.normalized_name),
  );
  const records = [];
  const ambiguousMatches = [];
  const conflicts = [];

  for (const incoming of incomingRiders) {
    const directIdMatch = existingById.get(incoming.id);
    const normalizedCandidates = existingByNormalizedName.get(
      key(incoming.grand_tour_id, incoming.normalized_name),
    ) ?? [];
    let match = directIdMatch?.grand_tour_id === incoming.grand_tour_id
      ? directIdMatch
      : null;
    let matchMethod = match ? "stable_id" : null;

    if (directIdMatch && directIdMatch.grand_tour_id !== incoming.grand_tour_id) {
      ambiguousMatches.push({
        incomingId: incoming.id,
        displayName: incoming.display_name,
        grandTourId: incoming.grand_tour_id,
        teamId: incoming.team_id,
        candidateIds: [directIdMatch.id],
        reason: "stable_id_exists_in_another_tour",
      });
      records.push({ action: "ambiguous", incoming, match: null, matchMethod: null, row: null });
      continue;
    }

    if (!match && normalizedCandidates.length === 1) {
      match = normalizedCandidates[0];
      matchMethod = "normalized_name_and_tour";
    } else if (!match && normalizedCandidates.length > 1 && incoming.team_id) {
      const teamCandidates = normalizedCandidates.filter(
        (candidate) => candidate.team_id === incoming.team_id,
      );
      if (teamCandidates.length === 1) {
        match = teamCandidates[0];
        matchMethod = "team_and_normalized_name";
      }
    }

    if (!match && normalizedCandidates.length > 0) {
      ambiguousMatches.push({
        incomingId: incoming.id,
        displayName: incoming.display_name,
        grandTourId: incoming.grand_tour_id,
        teamId: incoming.team_id,
        candidateIds: normalizedCandidates.map((candidate) => candidate.id),
      });
      records.push({ action: "ambiguous", incoming, match: null, matchMethod: null, row: null });
      continue;
    }

    if (!match) {
      records.push({ action: "insert", incoming, match: null, matchMethod: null, row: incoming });
      continue;
    }

    const fieldChanges = TRACKED_FIELDS
      .filter((field) => incoming[field] !== match[field])
      .map((field) => ({ field, existing: match[field] ?? null, incoming: incoming[field] ?? null }));
    const fieldConflicts = fieldChanges.filter(
      ({ existing, incoming: incomingValue }) => hasValue(existing) && hasValue(incomingValue),
    );
    if (fieldConflicts.length > 0) {
      conflicts.push({
        incomingId: incoming.id,
        existingId: match.id,
        displayName: incoming.display_name,
        matchMethod,
        fields: fieldConflicts,
      });
    }
    records.push({
      action: fieldChanges.length > 0 ? "update" : "skip",
      incoming,
      match,
      matchMethod,
      row: { ...incoming, id: match.id },
    });
  }

  const sourceSummary = summarizeRiderSource(incomingRiders);
  return {
    records,
    conflicts,
    ambiguousMatches,
    summary: {
      ridersUpdated: records.filter(({ action }) => action === "update").length,
      ridersInserted: records.filter(({ action }) => action === "insert").length,
      ridersSkipped: records.filter(({ action }) => action === "skip" || action === "ambiguous").length,
      ambiguousMatches: ambiguousMatches.length,
      missingBibNumbers: sourceSummary.missingBibNumbers,
      duplicateBibNumbersPerTourTeam: sourceSummary.duplicateBibNumbersPerTourTeam,
    },
  };
}
