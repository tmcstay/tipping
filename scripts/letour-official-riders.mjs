function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

export function parseOfficialTourRidersHtml(html) {
  const section = html.match(/<section class="competitors">([\s\S]*?)<\/section>/)?.[1];
  if (!section) throw new Error("Official riders page does not contain the competitors section");

  const teamPattern = /<h3 class="list__heading"><a href="\/en\/team\/([^/]+)\/([^"]+)">([^<]+)<\/a><\/h3><div class="list__box">([\s\S]*?)<\/div>/g;
  const riderPattern = /<span class="bib">(\d+)<\/span><span class="runner"><span class="flag js-display-lazy" data-class="flag--([a-z]+)"><\/span><a class="runner__link" href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/g;
  const teams = [];

  for (const match of section.matchAll(teamPattern)) {
    const [, code, slug, rawName, box] = match;
    const riders = [...box.matchAll(riderPattern)].map((riderMatch) => ({
      bib_number: Number(riderMatch[1]),
      nationality: riderMatch[2].toUpperCase(),
      profile_url: new URL(riderMatch[3], "https://www.letour.fr").href,
      official_name: decodeHtml(riderMatch[4]).replace(/\s+/g, " "),
    }));
    if (riders.length !== 8) {
      throw new Error(`Official team ${rawName} has ${riders.length} parsed riders; expected 8`);
    }
    teams.push({
      code,
      slug,
      name: decodeHtml(rawName).replace(/\s+/g, " "),
      source_url: `https://www.letour.fr/en/team/${code}/${slug}`,
      riders,
    });
  }

  if (teams.length !== 23) {
    throw new Error(`Official riders page has ${teams.length} parsed teams; expected 23`);
  }
  const bibs = teams.flatMap(({ riders }) => riders.map(({ bib_number }) => bib_number));
  if (new Set(bibs).size !== 184) throw new Error("Official riders page contains duplicate bib numbers");
  return teams;
}
