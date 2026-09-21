import platformGroups from "./gtfs-stops.json";

// Hubs anchor the groove, line ends accent it, everything else fills in.
export type Role = "kick" | "snare" | "hihat" | "bass" | "lead";
export const ROLES: Role[] = ["kick", "snare", "hihat", "bass", "lead"];
export const ROLE_LABEL: Record<Role, string> = {
  kick: "Kick",
  snare: "Snare",
  hihat: "Hi-hat",
  bass: "Bass",
  lead: "Lead",
};

export type StopNode = {
  key: string;
  label: string;
  gtfsNames: string[];
  gtfsStopIds: string[];
  noteStep: number;
  role: Role;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  angle: number;
  anchor: "start" | "middle" | "end";
  hub: boolean;
};

// Coordinates are registered to the original 1778 × 1408 artwork. All platforms
// at a named place share this node, its pitch, and (in v2) its sample assignment.
type Position = [
  name: string,
  x: number,
  y: number,
  labelX?: number,
  labelY?: number,
];
const positions: (Position & {
  angle?: number;
  anchor?: StopNode["anchor"];
  hub?: boolean;
})[] = [];
function group(
  rows: Position[],
  angle = 0,
  anchor: StopNode["anchor"] = "start",
  hub = false,
) {
  positions.push(
    ...rows.map((row) => Object.assign(row, { angle, anchor, hub })),
  );
}

group([
  ["Górka Narodowa", 724, 118, 736, 122],
  ["Papierni Prądnickich", 724, 148, 736, 152],
  ["Kuźnicy Kołłątajowskiej", 724, 178, 736, 181],
  ["Krowodrza Górka", 476, 222, 499, 226],
  ["Bratysławska", 476, 252, 499, 256],
  ["Szpital Narutowicza", 476, 282, 499, 286],
]);
group(
  [
    ["Pachońskiego", 512, 197, 512, 184],
    ["Białoprądnicka", 542, 197, 542, 184],
    ["Górnickiego", 572, 197, 572, 184],
    ["Siewna Wiadukt", 602, 197, 602, 184],
    ["Bociana", 631, 197, 631, 184],
  ],
  -45,
);
group(
  [
    ["Dworzec Towarowy", 537, 345, 518, 382],
    ["Stary Kleparz", 538, 525, 520, 501],
  ],
  0,
  "end",
  true,
);
group(
  [
    ["Nowy Kleparz", 539, 422, 525, 426],
    ["Pędzichów", 539, 459, 525, 463],
  ],
  0,
  "end",
);
group([["Politechnika", 632, 400, 609, 405]], 0, "end");
group([["Dworzec Główny Tunel", 743, 433, 743, 389]], 0, "middle");
group([["Dworzec Główny Zachód", 624, 475, 612, 467]], 0, "end");
group(
  [
    ["Bronowice Małe", 165, 355, 165, 340],
    ["Bronowice SKA", 194, 355, 195, 340],
    ["Wesele", 224, 355, 225, 340],
    ["Bronowice", 254, 361, 256, 341],
    ["Głowackiego", 307, 384, 316, 368],
    ["Uniwersytet Pedagogiczny", 328, 405, 337, 389],
    ["Biprostal", 350, 427, 359, 411],
    ["Urzędnicza", 372, 449, 381, 433],
    ["Plac Inwalidów", 394, 471, 404, 455],
    ["Batorego", 416, 493, 426, 477],
  ],
  -45,
);
group([["Teatr Bagatela", 465, 554, 490, 586]], 0, "start", true);
group(
  [
    ["Cichy Kącik", 217, 623, 217, 607],
    ["Reymana", 246, 623, 247, 607],
    ["Park Jordana", 276, 623, 277, 607],
    ["Oleandry", 305, 623, 306, 607],
    ["Muzeum Narodowe", 335, 623, 336, 607],
    ["UJ / AST", 365, 623, 366, 607],
  ],
  -45,
);
group(
  [
    ["Salwator Pętla", 214, 745, 215, 731],
    ["Salwator", 244, 745, 245, 731],
    ["Komorowskiego", 273, 745, 274, 731],
    ["Jubilat", 303, 745, 304, 731],
  ],
  -45,
);
group(
  [
    ["Filharmonia", 464, 688, 482, 667],
    ["Poczta Główna", 600, 694, 631, 696],
    ["Teatr Słowackiego", 633, 533, 650, 568],
  ],
  0,
  "start",
  true,
);
group([["Plac Wszystkich Świętych", 528, 712, 528, 746]], 0, "end");
group([["Lubicz", 743, 532, 743, 501]], 0, "middle");
group([
  ["Cmentarz Rakowicki", 802, 341, 813, 345],
  ["Muzeum Fotografii", 802, 370, 813, 374],
  ["Uniwersytet Ekonomiczny", 802, 400, 813, 404],
]);
group(
  [
    ["Rondo Mogilskie", 882, 532, 909, 569],
    ["Rondo Grzegórzeckie", 882, 706, 910, 738],
    ["Starowiślna", 675, 770, 710, 775],
    ["Stradom", 560, 857, 584, 886],
    ["Limanowskiego", 702, 967, 728, 972],
    ["Lipska", 894, 1043, 918, 1020],
    ["Łagiewniki", 357, 1043, 383, 1072],
    ["Bieżanowska", 695, 1215, 696, 1246],
  ],
  0,
  "start",
  true,
);
group(
  [
    ["Cystersów", 950, 527, 950, 504],
    ["Białucha", 980, 527, 980, 504],
    ["TAURON Arena Wieczysta", 1009, 527, 1009, 504],
    ["Muzeum Lotnictwa Polskiego", 1039, 527, 1039, 504],
    ["AWF", 1069, 527, 1069, 504],
    ["Stella-Sawickiego", 1098, 527, 1098, 504],
    ["Czyżyny", 1128, 527, 1128, 504],
  ],
  -45,
);
group(
  [
    ["Teatr Variete", 950, 705, 950, 692],
    ["Francesco Nullo", 980, 705, 980, 692],
    ["Fabryczna", 1009, 705, 1009, 692],
    ["Ofiar Dąbia", 1039, 705, 1039, 692],
    ["Dąbie", 1069, 705, 1069, 692],
  ],
  -45,
);
group(
  [
    ["TAURON Arena al. Pokoju", 1134, 678, 1124, 666],
    ["Rondo 308. Dywizjonu", 1156, 656, 1146, 644],
    ["Centralna", 1178, 634, 1168, 622],
  ],
  45,
  "end",
);
group([["Hala Targowa", 772, 706, 772, 686]], 0, "middle");
group([
  ["św. Gertrudy", 561, 771, 581, 771],
  ["Wawel", 561, 801, 581, 805],
  ["Plac Wolnica", 561, 912, 583, 916],
  ["Miodowa", 702, 830, 722, 834],
  ["św. Wawrzyńca", 702, 860, 722, 864],
  ["Plac Bohaterów Getta", 702, 912, 722, 916],
  ["Podgórze SKA", 702, 1015, 722, 1019],
  ["Cmentarz Podgórski", 702, 1060, 722, 1060],
  ["Dworcowa", 702, 1090, 722, 1094],
  ["Kabel", 695, 1164, 722, 1168],
  ["Zabłocie", 891, 830, 906, 834],
  ["Klimeckiego", 891, 860, 906, 864],
  ["Kuklińskiego", 891, 890, 906, 894],
  ["Gromadzka", 891, 919, 906, 923],
]);
group([["Dworzec Płaszów Estakada", 854, 1090, 865, 1110]]);
group([["Korona", 561, 967, 561, 1000]], 0, "middle", true);
group(
  [
    ["Rzebika", 980, 1045, 980, 1030],
    ["Mały Płaszów", 1010, 1045, 1010, 1030],
  ],
  -45,
);
group(
  [
    ["Rondo Grunwaldzkie", 446, 856, 446, 836],
    ["Orzeszkowej", 475, 856, 475, 836],
    ["Szwedzka", 416, 867, 402, 853],
    ["Kapelanka", 394, 889, 380, 875],
    ["Słomiana", 375, 908, 361, 894],
    ["Kobierzyńska", 310, 946, 296, 932],
    ["Lipińskiego", 294, 962, 280, 948],
    ["Grota-Roweckiego", 274, 982, 260, 968],
    ["Norymberska", 252, 1004, 238, 990],
    ["Ruczaj", 230, 1026, 216, 1012],
    ["Kampus UJ", 209, 1047, 195, 1033],
    ["Chmieleniec", 196, 1060, 182, 1046],
    ["Czerwone Maki", 185, 1071, 171, 1057],
  ],
  45,
  "end",
);
group([
  ["Borsucza", 357, 963, 371, 967],
  ["Brożka", 357, 993, 374, 997],
]);
group(
  [
    ["Smolki", 480, 991, 494, 1004],
    ["Rondo Matecznego", 460, 1012, 474, 1025],
    ["Rzemieślnicza", 441, 1032, 455, 1045],
  ],
  45,
);
group([["Łagiewniki ZUS", 324, 1112, 305, 1094]], 45, "end");
group([["Łagiewniki SKA", 285, 1154, 264, 1122]], 45, "end", true);
group(
  [
    ["Solvay", 240, 1185, 225, 1173],
    ["Borek Fałęcki I", 221, 1205, 205, 1193],
    ["Borek Fałęcki", 201, 1225, 185, 1213],
  ],
  45,
  "end",
);
group([["Sanktuarium Bożego Miłosierdzia", 387, 1215, 387, 1241]], 0, "middle");
group(
  [
    ["Turowicza", 461, 1215, 461, 1198],
    ["Kurdwanów", 490, 1215, 490, 1198],
    ["Witosa", 520, 1215, 520, 1198],
    ["Nowosądecka", 550, 1215, 550, 1198],
    ["Piaski Nowe", 579, 1215, 579, 1198],
    ["Dauna", 609, 1215, 609, 1198],
    ["Wlotowa", 832, 1215, 832, 1198],
    ["Prokocim", 861, 1215, 861, 1198],
    ["Prokocim Szpital", 891, 1215, 891, 1198],
    ["Teligi", 920, 1215, 920, 1198],
    ["Nowy Prokocim", 950, 1215, 950, 1198],
    ["Ćwiklińskiej", 980, 1215, 980, 1198],
    ["Nowy Bieżanów", 1010, 1215, 1010, 1198],
  ],
  -45,
);
group(
  [
    ["Mistrzejowice", 994, 319, 994, 305],
    ["Miśnieńska", 1024, 319, 1024, 305],
    ["Os. Złotego Wieku", 1054, 319, 1054, 305],
    ["Rondo Piastowskie", 1084, 319, 1084, 305],
  ],
  -45,
);
group([
  ["Os. Piastów", 1169, 207, 1181, 211],
  ["Piasta Kołodzieja", 1169, 237, 1181, 241],
  ["Kleeberga", 1169, 267, 1181, 271],
]);
group(
  [
    ["Dunikowskiego", 1201, 343, 1206, 333],
    ["Rondo Hipokratesa", 1223, 365, 1228, 355],
    ["DH Wanda", 1245, 387, 1250, 377],
  ],
  -45,
);
group([["Rondo Kocmyrzowskie", 1267, 425, 1299, 410]], 0, "start", true);
group([["Bieńczycka", 1230, 459, 1218, 447]], 45, "end");
group([["Rondo Czyżyńskie", 1218, 526, 1242, 560]], 0, "start", true);
group([["Os. Kolorowe", 1281, 527, 1281, 507]], 0, "middle");
group([["Os. Zgody", 1305, 473, 1318, 463]], -45);
group([["Plac Centralny", 1373, 520, 1373, 476]], 0, "middle", true);
group(
  [
    ["Teatr Ludowy", 1358, 345, 1358, 332],
    ["Cienista", 1387, 345, 1387, 332],
    ["Wańkowicza", 1417, 345, 1417, 332],
  ],
  45,
  "end",
);
group([
  ["Wzgórza Krzesławickie", 1469, 207, 1484, 211],
  ["Jarzębiny", 1469, 237, 1484, 241],
  ["Darwina", 1469, 267, 1484, 271],
  ["Wiadukty", 1469, 296, 1484, 300],
]);
group([["Elektromontaż", 1528, 348, 1528, 336]], -45);
group([
  ["Zajezdnia Nowa Huta", 1565, 370, 1578, 374],
  ["Kombinat", 1565, 415, 1585, 419],
]);
group([["Struga", 1448, 474, 1434, 453]], 45, "end");
group([["Kopiec Wandy", 1565, 475, 1552, 474]], 0, "end");
group(
  [
    ["Os. Na Skarpie", 1461, 515, 1444, 536],
    ["Klasztorna", 1491, 515, 1474, 536],
    ["Suche Stawy", 1521, 515, 1504, 536],
    ["Bardosa", 1550, 515, 1533, 536],
  ],
  -45,
  "end",
);
group([
  ["Fort Mogiła", 1569, 541, 1581, 545],
  ["Brama nr 4", 1569, 571, 1581, 575],
  ["Giedroycia", 1569, 600, 1581, 604],
  ["Brama nr 5", 1569, 630, 1581, 634],
  ["Meksyk", 1569, 660, 1581, 664],
  ["Koksochemia", 1569, 689, 1581, 693],
  ["Pleszów", 1569, 719, 1581, 723],
]);

// Explicit historical/abbreviated names from the reference. No fuzzy matching.
const aliases: Record<string, string[]> = {
  "Górka Narodowa": ["Górka Narodowa P+R"],
  "Krowodrza Górka": ["Krowodrza Górka P+R"],
  Pachońskiego: ["Pachońskiego P+R"],
  "Kuźnicy Kołłątajowskiej": [
    "Kuźnicy Kołłątajowskiej",
    "Kuźnica Kołłątajowskiej",
  ],
  "Uniwersytet Pedagogiczny": ["Uniwersytet Pedagogiczny", "UKEN"],
  "Salwator Pętla": ["Salwator"],
  Salwator: ["Salwator"],
  "TAURON Arena Wieczysta": ["TAURON Arena Kraków Wieczysta"],
  "TAURON Arena al. Pokoju": ["TAURON Arena Kraków Al. Pokoju"],
  AWF: ["AKF / PK", "AWF"],
  "Francesco Nullo": ["Nullo", "Francesco Nullo"],
  Centralna: ["Gałczyńskiego"],
  Batorego: ["Stefana Batorego", "Batorego"],
  "Mały Płaszów": ["Mały Płaszów P+R"],
  "Czerwone Maki": ["Czerwone Maki P+R"],
  Chmieleniec: ["Chmieleniec", "Kampus UP JP II"],
  // June 2024 rename: krakow.pl/aktualnosci/284127
  "Borek Fałęcki I": ["Solvay"],
  Solvay: ["Kościuszkowców"],
  Kurdwanów: ["Kurdwanów P+R"],
  "Nowy Bieżanów": ["Nowy Bieżanów P+R"],
  "Rondo Kocmyrzowskie": ["Rondo Kocmyrzowskie im. ks. Gorzelanego"],
  "Plac Centralny": ["Plac Centralny im. R. Reagana"],
  Wiadukty: ["Wiadukty"],
};

// End-of-line loops on the reference map. The diagram has no line topology, so
// termini are listed by hand; hubs take precedence when a stop is both.
const termini = new Set([
  "Górka Narodowa",
  "Krowodrza Górka",
  "Bronowice Małe",
  "Cichy Kącik",
  "Salwator Pętla",
  "Salwator", // Same loop; the map draws both ends of it.
  "Czerwone Maki",
  "Borek Fałęcki",
  "Kurdwanów",
  "Nowy Bieżanów",
  "Mały Płaszów",
  "Dąbie",
  "Cmentarz Rakowicki",
  "Mistrzejowice",
  "Os. Piastów",
  "Wzgórza Krzesławickie",
  "Kombinat",
  "Kopiec Wandy",
  "Pleszów",
]);
function roleFor(label: string, hub: boolean, hash: number): Role {
  if (hub) return "kick";
  if (termini.has(label)) return "snare";
  // Half the mid-line stops carry the melody; the rest split hats and bass.
  return (["lead", "lead", "hihat", "bass"] as const)[hash % 4];
}

const groups = platformGroups as Record<string, string[]>;
export const mapStops: StopNode[] = positions.map((row) => {
  const [label, x, y, labelX = x + 12, labelY = y + 4] = row;
  const dx = labelX - x;
  const dy = labelY - y;
  const spacing = Math.max(1, 20 / Math.hypot(dx, dy));
  const gtfsNames = aliases[label] ?? [label];
  const key = (label === "Salwator Pętla" ? "Salwator" : label)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const hash = [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    key,
    label,
    x,
    y,
    // Normalize engine-specific Math.hypot rounding before SVG hydration.
    labelX: Number((x + dx * spacing).toFixed(6)),
    labelY: Number((y + dy * spacing).toFixed(6)),
    angle: row.angle ?? 0,
    anchor: row.anchor ?? "start",
    hub: row.hub ?? false,
    gtfsNames,
    gtfsStopIds: [...new Set(gtfsNames.flatMap((name) => groups[name] ?? []))],
    noteStep: hash % 16,
    role: roleFor(label, row.hub ?? false, hash),
  };
});

export const stops = [
  ...new Map(mapStops.map((stop) => [stop.key, stop])).values(),
];
export const stopsByKey = new Map(stops.map((stop) => [stop.key, stop]));
export function buildStopIndex(nodes: Pick<StopNode, "key" | "gtfsStopIds">[]) {
  const index = new Map<string, string>();
  for (const stop of nodes) {
    for (const platform of stop.gtfsStopIds) {
      if (index.has(platform))
        throw new Error(`Platform ${platform} is assigned to two stops`);
      index.set(platform, stop.key);
    }
  }
  return index;
}
export const stopKeyByPlatform = buildStopIndex(stops);
