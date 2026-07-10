#!/usr/bin/env node

/**
 * Load official Tour de France 2026 start list into Supabase.
 *
 * What it does:
 * - Finds Tour de France 2026 in public.grand_tours
 * - Ensures 23 teams exist
 * - Ensures 184 official riders exist, 8 per team
 * - Sets canonical rider bibs on public.grandtour_riders.bib_number
 * - Populates/updates every stage startlist with confirmed riders and bibs
 * - Marks non-official riders/startlist rows inactive/DNS unless --keep-nonstarters is used
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 * - GRAND_TOUR_ID
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

loadDotEnv();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const keepNonstarters = args.includes("--keep-nonstarters");
const confirmTour = getArg("--confirm-tour");

if (apply && confirmTour !== "Tour de France 2026") {
  throw new Error(
    'Refusing to apply. Re-run with: --apply --confirm-tour "Tour de France 2026"',
  );
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SOURCE_URL = "https://www.letour.fr/en/riders";

const STARTLIST = [
  {
    name: "UAE Team Emirates XRG",
    aliases: ["UAE Team Emirates - XRG", "UAE Team Emirates XRG"],
    team_type: "WorldTeam",
    riders: [
      [1, "Tadej Pogačar", ["Tadej Pogacar"]],
      [2, "Isaac del Toro"],
      [3, "Felix Großschartner", ["Felix Grossschartner"]],
      [4, "Brandon McNulty"],
      [5, "Nils Politt"],
      [6, "Florian Vermeersch"],
      [7, "Tim Wellens"],
      [8, "Adam Yates"],
    ],
  },
  {
    name: "Team Visma | Lease a Bike",
    aliases: ["Team Visma | Lease a Bike"],
    team_type: "WorldTeam",
    riders: [
      [11, "Jonas Vingegaard"],
      [12, "Edoardo Affini"],
      [13, "Bruno Armirail"],
      [14, "Victor Campenaerts"],
      [15, "Per Strand Hagenes"],
      [16, "Matteo Jorgenson"],
      [17, "Sepp Kuss"],
      [18, "Davide Piganzoli"],
    ],
  },
  {
    name: "Red Bull - BORA - hansgrohe",
    aliases: ["Red Bull - Bora - Hansgrohe", "Red Bull - BORA - hansgrohe"],
    team_type: "WorldTeam",
    riders: [
      [21, "Remco Evenepoel"],
      [22, "Mattia Cattaneo"],
      [23, "Nico Denz"],
      [24, "Jai Hindley"],
      [25, "Florian Lipowitz"],
      [26, "Jan Tratnik"],
      [27, "Tim van Dijke"],
      [28, "Maxim Van Gils"],
    ],
  },
  {
    name: "Lidl - Trek",
    aliases: ["Lidl-Trek", "Lidl - Trek"],
    team_type: "WorldTeam",
    riders: [
      [31, "Juan Ayuso"],
      [32, "Derek James Gee", ["Derek Gee-West", "Derek Gee"]],
      [33, "Mads Pedersen"],
      [34, "Quinn Simmons"],
      [35, "Mattias Skjelmose"],
      [36, "Toms Skujiņš", ["Toms Skujins"]],
      [37, "Mathias Vacek"],
      [38, "Carlos Verona"],
    ],
  },
  {
    name: "EF Education - EasyPost",
    aliases: ["EF Education - EasyPost"],
    team_type: "WorldTeam",
    riders: [
      [41, "Richard Carapaz"],
      [42, "Kasper Asgreen"],
      [43, "Alex Baudin"],
      [44, "Ben Healy"],
      [45, "Sean Quinn"],
      [46, "Georg Steinhauser"],
      [47, "Michael Valgren"],
      [48, "Max Walker"],
    ],
  },
  {
    name: "Decathlon CMA CGM Team",
    aliases: ["Decathlon CMA CGM Team"],
    team_type: "WorldTeam",
    riders: [
      [51, "Paul Seixas"],
      [52, "Tiesj Benoot"],
      [53, "Cees Bol"],
      [54, "Daan Hoole"],
      [55, "Olav Kooij"],
      [56, "Aurélien Paret-Peintre", ["Aurélien Paret Peintre"]],
      [57, "Nicolas Prodhomme"],
      [58, "Matthew Riccitello"],
    ],
  },
  {
    name: "XDS Astana Team",
    aliases: ["XDS Astana Team"],
    team_type: "WorldTeam",
    riders: [
      [61, "Sergio Higuita"],
      [62, "Davide Ballerini"],
      [63, "Aaron Murray Gate", ["Aaron Gate"]],
      [64, "Max Kanter"],
      [65, "Harold Tejada"],
      [66, "Mike Teunissen"],
      [67, "Simone Velasco"],
      [68, "Nicolas Vinokurov", ["Nicolya Vinokurov"]],
    ],
  },
  {
    name: "Bahrain - Victorious",
    aliases: ["Bahrain Victorious", "Bahrain - Victorious"],
    team_type: "WorldTeam",
    riders: [
      [71, "Lenny Martinez"],
      [72, "Phil Bauhaus"],
      [73, "Damiano Caruso"],
      [74, "Kamil Gradek"],
      [75, "Matej Mohorič", ["Matej Mohoric"]],
      [76, "Robert Stannard"],
      [77, "Antonio Tiberi"],
      [78, "Vlad Van Mechelen"],
    ],
  },
  {
    name: "Netcompany INEOS Cycling Team",
    aliases: ["Netcompany INEOS", "Netcompany INEOS Cycling Team"],
    team_type: "WorldTeam",
    riders: [
      [81, "Egan Bernal"],
      [82, "Thymen Arensman"],
      [83, "Tobias Foss"],
      [84, "Filippo Ganna"],
      [85, "Dorian Godon"],
      [86, "Michał Kwiatkowski", ["Michal Kwiatkowski"]],
      [87, "Joshua Tarling"],
      [88, "Kévin Vauquelin", ["Kevin Vauquelin"]],
    ],
  },
  {
    name: "Soudal Quick-Step",
    aliases: ["Soudal Quick-Step"],
    team_type: "WorldTeam",
    riders: [
      [91, "Tim Merlier"],
      [92, "Pascal Eenkhoorn"],
      [93, "Valentin Paret-Peintre", ["Valentin Paret Peintre"]],
      [94, "Jasper Stuyven"],
      [95, "Dylan van Baarle"],
      [96, "Bert Van Lerberghe"],
      [97, "Ilan Van Wilder"],
      [98, "Louis Vervaeke"],
    ],
  },
  {
    name: "Alpecin - Premier Tech",
    aliases: ["Alpecin-Premier Tech", "Alpecin - Premier Tech"],
    team_type: "WorldTeam",
    riders: [
      [101, "Mathieu van der Poel"],
      [102, "Ramses Debruyne"],
      [103, "Silvan Dillier"],
      [104, "Tim Marsman"],
      [105, "Jasper Philipsen"],
      [106, "Edward Planckaert"],
      [107, "Jonas Rickaert"],
      [108, "Emiel Verstrynge"],
    ],
  },
  {
    name: "Team Jayco AlUla",
    aliases: ["Team Jayco AlUla"],
    team_type: "WorldTeam",
    riders: [
      [111, "Ben O'Connor", ["Ben O’Connor"]],
      [112, "Pascal Ackermann"],
      [113, "Luke Durbridge"],
      [114, "Felix Engelhardt"],
      [115, "Michael Matthews"],
      [116, "Kelland O'Brien", ["Kelland O’Brien"]],
      [117, "Luke Plapp"],
      [118, "Mauro Schmid"],
    ],
  },
  {
    name: "Uno-X Mobility",
    aliases: ["Uno-X Mobility"],
    team_type: "WorldTeam",
    riders: [
      [121, "Tobias Halland Johannessen", ["Tobias Johannessen"]],
      [122, "Jonas Abrahamsen"],
      [123, "Anthon Charmig"],
      [124, "Magnus Cort", ["Magnus Cort Nielsen"]],
      [125, "Anders Halland Johannessen", ["Anders Johannessen"]],
      [126, "Anders Skaarseth"],
      [127, "Torstein Træen"],
      [128, "Søren Wærenskjold", ["Soren Waerenskjold"]],
    ],
  },
  {
    name: "NSN Cycling Team",
    aliases: ["NSN Cycling Team"],
    team_type: "WorldTeam",
    riders: [
      [131, "Biniam Girmay"],
      [132, "Lewis Askey"],
      [133, "George Bennett"],
      [134, "Marco Frigo"],
      [135, "Matis Louvel"],
      [136, "Krists Neilands"],
      [137, "Jake Stewart"],
      [138, "Tom Van Asbroeck"],
    ],
  },
  {
    name: "Movistar Team",
    aliases: ["Movistar Team"],
    team_type: "WorldTeam",
    riders: [
      [141, "Cian Uijtdebroeks"],
      [142, "Pablo Castrillo"],
      [143, "Jefferson Cepeda"],
      [144, "Raul García", ["Raul Garcia"]],
      [145, "Michel Heßmann", ["Michel Hessmann"]],
      [146, "Nelson Oliveira"],
      [147, "Javier Romo"],
      [148, "Einer Rubio"],
    ],
  },
  {
    name: "Lotto Intermarché",
    aliases: ["Lotto Intermarche", "Lotto Intermarché"],
    team_type: "WorldTeam",
    riders: [
      [151, "Arnaud De Lie"],
      [152, "Huub Artz"],
      [153, "Jenno Berckmoes"],
      [154, "Lars Craps"],
      [155, "Liam Slock"],
      [156, "Lennert Van Eetvelt"],
      [157, "Baptiste Veistroffer"],
      [158, "Georg Zimmermann"],
    ],
  },
  {
    name: "Cofidis",
    aliases: ["Cofidis"],
    team_type: "ProTeam",
    riders: [
      [161, "Ion Izagirre"],
      [162, "Piet Allegaert"],
      [163, "Alex Aranburu"],
      [164, "Jenthe Biermans"],
      [165, "Milan Fretin"],
      [166, "Alex Kirsch"],
      [167, "Hugo Page"],
      [168, "Benjamin Thomas"],
    ],
  },
  {
    name: "Pinarello-Q36.5 Pro Cycling Team",
    aliases: [
      "Pinarello Q36.5 Pro Cycling Team",
      "Pinarello-Q36.5 Pro Cycling Team",
    ],
    team_type: "ProTeam",
    riders: [
      [171, "Tom Pidcock"],
      [172, "Xabier Azparren Irurzun"],
      [173, "Christopher Harper"],
      [174, "Quinten Hermans"],
      [175, "Damien Howson", ["Damien Craig Howson"]],
      [176, "Xandro Meurisse"],
      [177, "Brent Van Moer"],
      [178, "Fred Wright"],
    ],
  },
  {
    name: "Groupama - FDJ United",
    aliases: ["Groupama-FDJ United", "Groupama - FDJ United"],
    team_type: "WorldTeam",
    riders: [
      [181, "Romain Grégoire", ["Romain Gregoire"]],
      [182, "Clément Berthet"],
      [183, "Clément Braz Afonso"],
      [184, "Ewen Costiou"],
      [185, "Lorenzo Germani"],
      [186, "Guillaume Martin", ["Guillaume Martin Guyonnet"]],
      [187, "Quentin Pacher"],
      [188, "Clément Russo"],
    ],
  },
  {
    name: "Tudor Pro Cycling Team",
    aliases: ["Tudor Pro Cycling Team"],
    team_type: "ProTeam",
    riders: [
      [191, "Julian Alaphilippe"],
      [192, "Arvid de Kleijn"],
      [193, "Marco Haller"],
      [194, "Marc Hirschi"],
      [195, "Rick Pluimers"],
      [196, "Michael Storer"],
      [197, "Matteo Trentin"],
      [198, "Yannis Voisard"],
    ],
  },
  {
    name: "TotalEnergies",
    aliases: ["TotalEnergies"],
    team_type: "ProTeam",
    riders: [
      [201, "Jordan Jegat", ["Jordan Jegat"]],
      [202, "Nicolas Breuillard"],
      [203, "Joris Delbove"],
      [204, "Alexandre Delettre"],
      [205, "Thibault Guernalec"],
      [206, "Mathis Le Berre"],
      [207, "Anthony Turgis"],
      [208, "Mattéo Vercher", ["Matteo Vercher"]],
    ],
  },
  {
    name: "Team Picnic PostNL",
    aliases: ["Team Picnic PostNL"],
    team_type: "WorldTeam",
    riders: [
      [211, "Warren Barguil"],
      [212, "Frits Biesterbos"],
      [213, "Pavel Bittner"],
      [214, "John Degenkolb"],
      [215, "Robbe Dhondt"],
      [216, "Niklas Märkl", ["Niklas Markl"]],
      [217, "Julius van den Berg"],
      [218, "Frank van den Broek"],
    ],
  },
  {
    name: "Caja Rural - Seguros RGA",
    aliases: ["Caja Rural-Seguros RGA", "Caja Rural - Seguros RGA"],
    team_type: "ProTeam",
    riders: [
      [221, "Fernando Gaviria"],
      [222, "Abel Balderstone"],
      [223, "Sebastian Berwick"],
      [224, "Alex Molenaar"],
      [225, "Joel Nicolau"],
      [226, "Stefano Oldani"],
      [227, "Jakub Otruba"],
      [228, "José Félix Parra", ["Jose Felix Parra"]],
    ],
  },
];

const stats = {
  teamsInserted: 0,
  teamsUpdated: 0,
  ridersInserted: 0,
  ridersUpdated: 0,
  startlistsInserted: 0,
  startlistsUpdated: 0,
  nonOfficialRidersMarked: 0,
  nonOfficialStartlistsMarked: 0,
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  validateStartlistShape();

  console.log(apply ? "APPLY MODE" : "DRY RUN");
  console.log(`keepNonstarters=${keepNonstarters}`);

  const grandTour = await getGrandTour();
  console.log(`Grand tour: ${grandTour.name} ${grandTour.year} ${grandTour.id}`);

  const stages = await selectAll("grandtour_stages", {
    grand_tour_id: grandTour.id,
  });

  if (stages.length === 0) {
    throw new Error("No stages found for Tour de France 2026.");
  }

  console.log(`Stages found: ${stages.length}`);

  const teamIdByOfficialName = await ensureTeams(grandTour.id);
  const officialRiderIds = await ensureRiders(grandTour.id, teamIdByOfficialName);

  if (!keepNonstarters) {
    await markNonOfficialRiders(grandTour.id, officialRiderIds);
  }

  await ensureStageStartlists(stages, teamIdByOfficialName, officialRiderIds);

  if (!keepNonstarters) {
    await markNonOfficialStartlistRows(stages, officialRiderIds);
  }

  await validateDatabase(grandTour.id);

  console.log("\nSummary");
  console.table(stats);

  if (!apply) {
    console.log("\nDry-run only. No database changes were written.");
    console.log(
      'Apply with: node scripts/load-tdf-2026-startlist.mjs --apply --confirm-tour "Tour de France 2026"',
    );
  }
}

async function getGrandTour() {
  if (process.env.GRAND_TOUR_ID) {
    const { data, error } = await supabase
      .from("grand_tours")
      .select("*")
      .eq("id", process.env.GRAND_TOUR_ID)
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("grand_tours")
    .select("*")
    .eq("name", "Tour de France")
    .eq("year", 2026)
    .single();

  if (error) throw error;
  return data;
}

async function ensureTeams(grandTourId) {
  const existingTeams = await selectAll("grandtour_teams", {
    grand_tour_id: grandTourId,
  });

  const teamIdByOfficialName = new Map();

  for (const officialTeam of STARTLIST) {
    const possibleNames = [officialTeam.name, ...(officialTeam.aliases ?? [])];
    const possibleKeys = new Set(possibleNames.map(normalize));

    let existing = existingTeams.find((team) =>
      possibleKeys.has(normalize(team.name)),
    );

    const payload = {
      grand_tour_id: grandTourId,
      name: officialTeam.name,
      team_type: officialTeam.team_type,
      source_url: SOURCE_URL,
      data_confidence: "high",
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      teamIdByOfficialName.set(officialTeam.name, existing.id);
      stats.teamsUpdated++;

      if (apply) {
        const { error } = await supabase
          .from("grandtour_teams")
          .update(payload)
          .eq("id", existing.id);

        if (error) throw error;
      }

      console.log(`TEAM update: ${existing.name} -> ${officialTeam.name}`);
    } else {
      stats.teamsInserted++;

      if (apply) {
        const { data, error } = await supabase
          .from("grandtour_teams")
          .insert(payload)
          .select("*")
          .single();

        if (error) throw error;

        existingTeams.push(data);
        teamIdByOfficialName.set(officialTeam.name, data.id);
      }

      console.log(`TEAM insert: ${officialTeam.name}`);
    }
  }

  if (!apply) {
    for (const team of STARTLIST) {
      const existing = existingTeams.find((candidate) =>
        new Set([team.name, ...(team.aliases ?? [])].map(normalize)).has(
          normalize(candidate.name),
        ),
      );

      if (existing) {
        teamIdByOfficialName.set(team.name, existing.id);
      }
    }
  }

  return teamIdByOfficialName;
}

async function ensureRiders(grandTourId, teamIdByOfficialName) {
  let existingRiders = await selectAll("grandtour_riders", {
    grand_tour_id: grandTourId,
  });

  const officialRiderIds = new Set();

  for (const team of STARTLIST) {
    const teamId = teamIdByOfficialName.get(team.name);

    if (!teamId && apply) {
      throw new Error(`Missing team id for ${team.name}`);
    }

    for (const [bib, displayName, aliases = []] of team.riders) {
      const possibleNames = [displayName, ...aliases];
      const possibleKeys = new Set(possibleNames.map(normalize));

      let existing = existingRiders.find(
        (rider) =>
          rider.team_id === teamId &&
          possibleKeys.has(normalize(rider.display_name)),
      );

      // Fallback for riders who may already exist under the tour but not attached to the right team.
      if (!existing) {
        existing = existingRiders.find((rider) =>
          possibleKeys.has(normalize(rider.display_name)),
        );
      }

      const payload = {
        grand_tour_id: grandTourId,
        team_id: teamId,
        display_name: displayName,
        normalized_name: normalize(displayName),
        bib_number: bib,
        is_active: true,
        status: "active",
        status_changed_at: new Date().toISOString(),
        status_reason: null,
        source_url: SOURCE_URL,
        data_confidence: "high",
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        officialRiderIds.add(existing.id);
        stats.ridersUpdated++;

        if (apply) {
          const { error } = await supabase
            .from("grandtour_riders")
            .update(payload)
            .eq("id", existing.id);

          if (error) throw error;
        }

        console.log(`RIDER update: #${bib} ${existing.display_name} -> ${displayName}`);
      } else {
        stats.ridersInserted++;

        if (apply) {
          const { data, error } = await supabase
            .from("grandtour_riders")
            .insert(payload)
            .select("*")
            .single();

          if (error) throw error;

          existingRiders.push(data);
          officialRiderIds.add(data.id);
        }

        console.log(`RIDER insert: #${bib} ${displayName}`);
      }
    }
  }

  if (!apply) {
    // In dry-run mode, rebuild official set from current matching rows only.
    for (const team of STARTLIST) {
      const teamId = teamIdByOfficialName.get(team.name);

      for (const [bib, displayName, aliases = []] of team.riders) {
        const possibleKeys = new Set([displayName, ...aliases].map(normalize));
        const existing = existingRiders.find(
          (rider) =>
            rider.team_id === teamId &&
            possibleKeys.has(normalize(rider.display_name)),
        );

        if (existing) officialRiderIds.add(existing.id);
      }
    }
  }

  return officialRiderIds;
}

async function markNonOfficialRiders(grandTourId, officialRiderIds) {
  const riders = await selectAll("grandtour_riders", {
    grand_tour_id: grandTourId,
  });

  const nonOfficial = riders.filter((rider) => !officialRiderIds.has(rider.id));
  stats.nonOfficialRidersMarked = nonOfficial.length;

  for (const rider of nonOfficial) {
    console.log(`RIDER non-official -> inactive/DNS: ${rider.display_name}`);

    if (apply) {
      const { error } = await supabase
        .from("grandtour_riders")
        .update({
          is_active: false,
          status: "dns",
          status_changed_at: new Date().toISOString(),
          status_reason: "Not on official Tour de France 2026 start list",
          updated_at: new Date().toISOString(),
        })
        .eq("id", rider.id);

      if (error) throw error;
    }
  }
}

async function ensureStageStartlists(stages, teamIdByOfficialName) {
  const riders = await selectAll("grandtour_riders", {});

  const officialByBib = new Map();

  for (const team of STARTLIST) {
    const teamId = teamIdByOfficialName.get(team.name);

    for (const [bib, displayName, aliases = []] of team.riders) {
      const possibleKeys = new Set([displayName, ...aliases].map(normalize));
      const rider = riders.find(
        (candidate) =>
          candidate.team_id === teamId &&
          possibleKeys.has(normalize(candidate.display_name)),
      );

      if (!rider && apply) {
        throw new Error(`Could not find rider after upsert: #${bib} ${displayName}`);
      }

      if (rider) {
        officialByBib.set(bib, {
          rider_id: rider.id,
          team_id: teamId,
          bib_number: bib,
          display_name: displayName,
        });
      }
    }
  }

  for (const stage of stages) {
    const existingRows = await selectAll("grandtour_stage_startlists", {
      stage_id: stage.id,
    });

    for (const official of officialByBib.values()) {
      const existing = existingRows.find(
        (row) => row.rider_id === official.rider_id,
      );

      const payload = {
        stage_id: stage.id,
        rider_id: official.rider_id,
        team_id: official.team_id,
        bib_number: official.bib_number,
        status: "confirmed",
        source_url: SOURCE_URL,
        data_confidence: "high",
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        stats.startlistsUpdated++;

        if (apply) {
          const { error } = await supabase
            .from("grandtour_stage_startlists")
            .update(payload)
            .eq("id", existing.id);

          if (error) throw error;
        }
      } else {
        stats.startlistsInserted++;

        if (apply) {
          const { error } = await supabase
            .from("grandtour_stage_startlists")
            .insert(payload);

          if (error) throw error;
        }
      }
    }

    console.log(
      `STAGE ${stage.stage_number}: ensured ${officialByBib.size} confirmed startlist riders`,
    );
  }
}

async function markNonOfficialStartlistRows(stages, officialRiderIds) {
  for (const stage of stages) {
    const rows = await selectAll("grandtour_stage_startlists", {
      stage_id: stage.id,
    });

    const nonOfficialRows = rows.filter(
      (row) => !officialRiderIds.has(row.rider_id),
    );

    stats.nonOfficialStartlistsMarked += nonOfficialRows.length;

    for (const row of nonOfficialRows) {
      if (apply) {
        const { error } = await supabase
          .from("grandtour_stage_startlists")
          .update({
            status: "dns",
            status_changed_at: new Date().toISOString(),
            status_reason: "Not on official Tour de France 2026 start list",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (error) throw error;
      }
    }
  }
}

async function validateDatabase(grandTourId) {
  const { data, error } = await supabase.rpc("version");

  // Ignore RPC availability; this is just a harmless connectivity touch.
  void data;
  void error;

  const validationSql = `
    with active_team_counts as (
      select
        t.name as team_name,
        count(r.id) filter (where r.is_active = true and r.status = 'active') as active_riders,
        count(r.id) filter (where r.is_active = true and r.status = 'active' and r.bib_number is not null) as active_riders_with_bib
      from public.grandtour_teams t
      left join public.grandtour_riders r
        on r.team_id = t.id
       and r.grand_tour_id = t.grand_tour_id
      where t.grand_tour_id = '${grandTourId}'
      group by t.id, t.name
    ),
    confirmed_stage_counts as (
      select
        s.stage_number,
        count(sl.id) filter (where sl.status = 'confirmed') as confirmed_rows,
        count(sl.id) filter (where sl.status = 'confirmed' and sl.bib_number is not null) as confirmed_rows_with_bib
      from public.grandtour_stages s
      left join public.grandtour_stage_startlists sl on sl.stage_id = s.id
      where s.grand_tour_id = '${grandTourId}'
      group by s.id, s.stage_number
    )
    select
      'team_counts_not_8' as check_name,
      jsonb_agg(to_jsonb(active_team_counts)) as failures
    from active_team_counts
    where active_riders <> 8 or active_riders_with_bib <> 8
    union all
    select
      'stage_counts_not_184' as check_name,
      jsonb_agg(to_jsonb(confirmed_stage_counts)) as failures
    from confirmed_stage_counts
    where confirmed_rows <> 184 or confirmed_rows_with_bib <> 184;
  `;

  const { data: validation, error: validationError } = await supabase.rpc(
    "execute_sql",
    { query: validationSql },
  );

  // Many projects do not expose an execute_sql RPC. Fall back to client-side validation.
  void validation;
  void validationError;

  await validateClientSide(grandTourId);
}

async function validateClientSide(grandTourId) {
  const teams = await selectAll("grandtour_teams", { grand_tour_id: grandTourId });
  const riders = await selectAll("grandtour_riders", { grand_tour_id: grandTourId });
  const stages = await selectAll("grandtour_stages", { grand_tour_id: grandTourId });

  const activeRiders = riders.filter(
    (r) => r.is_active === true && r.status === "active",
  );

  const activeWithBibs = activeRiders.filter((r) => r.bib_number !== null);

  // Team-count validation only applies to the 23 official STARTLIST teams.
  // Non-official teams that may already exist in this grand tour (e.g. a
  // pre-existing local test/dummy fixture) are expected to end up with 0
  // active riders once markNonOfficialRiders() runs, and must not be
  // reported as validation failures for that.
  const officialTeams = teams.filter((team) =>
    STARTLIST.some((officialTeam) =>
      [officialTeam.name, ...(officialTeam.aliases ?? [])]
        .map(normalize)
        .includes(normalize(team.name)),
    ),
  );

  const teamFailures = [];

  for (const team of officialTeams) {
    const teamRiders = activeRiders.filter((r) => r.team_id === team.id);
    const teamRidersWithBibs = teamRiders.filter((r) => r.bib_number !== null);

    if (teamRiders.length !== 8 || teamRidersWithBibs.length !== 8) {
      teamFailures.push({
        team: team.name,
        activeRiders: teamRiders.length,
        activeRidersWithBibs: teamRidersWithBibs.length,
      });
    }
  }

  const stageFailures = [];

  for (const stage of stages) {
    const rows = await selectAll("grandtour_stage_startlists", {
      stage_id: stage.id,
    });

    const confirmed = rows.filter((row) => row.status === "confirmed");
    const confirmedWithBibs = confirmed.filter((row) => row.bib_number !== null);

    if (confirmed.length !== 184 || confirmedWithBibs.length !== 184) {
      stageFailures.push({
        stage_number: stage.stage_number,
        confirmedRows: confirmed.length,
        confirmedRowsWithBibs: confirmedWithBibs.length,
      });
    }
  }

  console.log("\nValidation");
  console.log(`Active official riders: ${activeRiders.length}`);
  console.log(`Active official riders with bibs: ${activeWithBibs.length}`);
  console.log(`Teams: ${teams.length} total, ${officialTeams.length} official`);
  console.log(`Stages: ${stages.length}`);

  if (teamFailures.length > 0) {
    console.error("\nTeam validation failures:");
    console.table(teamFailures);
  }

  if (stageFailures.length > 0) {
    console.error("\nStage startlist validation failures:");
    console.table(stageFailures);
  }

  if (apply && (teamFailures.length > 0 || stageFailures.length > 0)) {
    throw new Error("Validation failed after apply.");
  }
}

async function selectAll(table, equals) {
  let query = supabase.from(table).select("*");

  for (const [key, value] of Object.entries(equals)) {
    query = query.eq(key, value);
  }

  const rows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);

    if (error) throw error;

    rows.push(...data);

    if (!data || data.length < pageSize) break;

    from += pageSize;
  }

  return rows;
}

function validateStartlistShape() {
  if (STARTLIST.length !== 23) {
    throw new Error(`Expected 23 teams, got ${STARTLIST.length}`);
  }

  const allBibs = [];

  for (const team of STARTLIST) {
    if (team.riders.length !== 8) {
      throw new Error(`${team.name} has ${team.riders.length} riders, expected 8`);
    }

    for (const [bib] of team.riders) {
      allBibs.push(bib);
    }
  }

  const uniqueBibs = new Set(allBibs);

  if (allBibs.length !== 184 || uniqueBibs.size !== 184) {
    throw new Error(
      `Expected 184 unique bibs, got ${allBibs.length} rows and ${uniqueBibs.size} unique bibs`,
    );
  }
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/\|/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function getArg(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
