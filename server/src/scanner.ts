import { request } from "node:https";
import { request as httpRequest } from "node:http";
import * as cheerio from "cheerio";
import { AppError, cleanUrl, publicHost } from "./security.js";
export type Fact = {
  kind: string;
  text: string;
  source: string;
  excerpt: string;
};
export type PageEvidence = {
  url: string;
  title: string;
  text: string;
  fetchedAt: string;
};
export async function fetchPage(
  input: URL,
  redirects = 0,
): Promise<{ url: URL; html: string }> {
  if (redirects > 4) throw new AppError(400, "Too many website redirects.");
  const u = cleanUrl(input.href),
    addresses = await publicHost(u.hostname);
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (u.protocol === "https:" ? request : httpRequest)(
      u,
      {
        headers: {
          "User-Agent":
            "ProspectDesk/0.1 (+company research; bounded public-page scanner)",
          Accept: "text/html",
        },
        lookup: (_hostname: any, options: any, callback: any) =>
          options?.all
            ? callback(null, [pinned])
            : callback(null, pinned.address, pinned.family),
        timeout: 12000,
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          fetchPage(new URL(res.headers.location, u), redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          reject(
            new AppError(
              422,
              `Website returned HTTP ${res.statusCode}. It may block automated access.`,
            ),
          );
          return;
        }
        if (!String(res.headers["content-type"]).includes("text/html")) {
          res.resume();
          reject(new AppError(422, "This URL does not return an HTML page."));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2_000_000) {
            req.destroy(new AppError(422, "Page exceeds the 2 MB scan limit."));
          } else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ url: u, html: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(
        new AppError(422, "Website timed out. Try another company URL."),
      ),
    );
    req.on("error", reject);
    req.end();
  });
}
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
export function parsePage(html: string, url: string) {
  const $ = cheerio.load(html);
  const title = tidy($("title").first().text());
  const company =
    $('meta[property="og:site_name"]').attr("content") ||
    title.split(/[|–—]|\s-\s/)[0].trim() ||
    new URL(url).hostname;
  const links = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get();
  $("script,style,nav,footer,header,noscript,svg,form").remove();
  $("body")
    .find("p,div,section,article,li,h1,h2,h3,h4,span,a,address,br")
    .each((_, el) => {
      $(el).after(" ");
    });
  const text = tidy($("body").text()).slice(0, 30000);
  const facts: Fact[] = [];
  const add = (kind: string, value: string, excerpt = value) => {
    value = tidy(value);
    if (value && !facts.some((f) => f.text === value))
      facts.push({
        kind,
        text: value.slice(0, 500),
        source: url,
        excerpt: tidy(excerpt).slice(0, 600),
      });
  };
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    $("main p,p")
      .filter((_, el) => tidy($(el).text()).length > 80)
      .first()
      .text();
  add("description", description || "");
  $("p,li").each((_, el) => {
    const statement = tidy($(el).text());
    if (
      statement.length >= 65 &&
      statement.length <= 450 &&
      !/cookie|privacy policy|terms of|all rights reserved/i.test(statement)
    )
      add("website statement", statement);
  });
  $("h1,h2,h3").each((_, el) => {
    const heading = tidy($(el).text());
    if (
      heading.length >= 8 &&
      heading.length <= 160 &&
      !/cookie|privacy|subscribe|sign in|menu|frequently asked|ready to|everything you need|get in touch|send us a message|linkedin/i.test(
        heading,
      )
    )
      add("website heading", heading, $(el).parent().text());
  });
  for (const href of links) {
    try {
      if (/^mailto:/i.test(href))
        add("email", decodeURIComponent(href.slice(7).split("?")[0]));
      if (/^tel:/i.test(href)) add("phone", decodeURIComponent(href.slice(4)));
    } catch {
      /* Ignore malformed contact URLs while preserving the rest of the page. */
    }
  }
  for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ||
    [])
    add("email", email);
  // JSON-LD locations are explicit website statements, not inferred geography.
  const json = cheerio.load(html);
  json('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = (obj: any) => {
        if (!obj || typeof obj !== "object") return;
        if (obj.address && typeof obj.address === "object")
          add(
            "location",
            [
              "streetAddress",
              "addressLocality",
              "addressRegion",
              "postalCode",
              "addressCountry",
            ]
              .map((k) =>
                typeof obj.address[k] === "string" ? obj.address[k] : "",
              )
              .filter(Boolean)
              .join(", "),
          );
        if (obj.telephone) add("phone", String(obj.telephone));
        if (obj.email) add("email", String(obj.email));
        for (const v of Object.values(obj))
          if (typeof v === "object")
            Array.isArray(v) ? v.forEach(walk) : walk(v);
      };
      walk(JSON.parse(json(el).text()));
    } catch {}
  });
  return {
    company: tidy(company),
    title,
    text,
    facts: facts.slice(0, 28),
    links,
  };
}
export async function scanWebsite(value: string) {
  const root = await fetchPage(cleanUrl(value)),
    parsed = parsePage(root.html, root.url.href);
  const pages: PageEvidence[] = [
    {
      url: root.url.href,
      title: parsed.title,
      text: parsed.text,
      fetchedAt: new Date().toISOString(),
    },
  ];
  const facts = [...parsed.facts],
    warnings: string[] = [];
  const candidates = parsed.links
    .map((href) => {
      try {
        return new URL(href, root.url);
      } catch {
        return null;
      }
    })
    .filter(
      (u): u is URL =>
        !!u &&
        u.origin === root.url.origin &&
        /about|services|solutions|contact/i.test(u.pathname) &&
        !/\.(pdf|jpg|png)$/i.test(u.pathname),
    );
  const urls = [
    ...new Set(
      candidates.map((u) => {
        u.hash = "";
        u.search = "";
        return u.href;
      }),
    ),
  ]
    .filter((x) => x !== root.url.href)
    .slice(0, 2);
  for (const url of urls) {
    try {
      const result = await fetchPage(new URL(url));
      const page = parsePage(result.html, result.url.href);
      pages.push({
        url: result.url.href,
        title: page.title,
        text: page.text,
        fetchedAt: new Date().toISOString(),
      });
      facts.push(...page.facts);
    } catch {
      warnings.push(
        `Could not read ${url}. The other pages are still available.`,
      );
    }
  }
  if (pages.reduce((sum, p) => sum + p.text.length, 0) < 300)
    warnings.push(
      "Very little readable text was found. This site may require JavaScript; no browser fallback was used.",
    );
  const unique = facts
    .filter(
      (f, i, all) =>
        all.findIndex(
          (x) =>
            x.kind === f.kind && x.text.toLowerCase() === f.text.toLowerCase(),
        ) === i,
    )
    .slice(0, 45);
  return {
    url: root.url.href,
    company: parsed.company,
    status: "complete",
    pages,
    facts: unique,
    warnings,
  };
}
