import { db } from "./index.js";
import * as schema from "./schema/index.js";

async function seed() {
  console.log("Seeding Sponsee local database...");

  // Create a creator
  const [creator] = await db
    .insert(schema.creators)
    .values({
      displayName: "Pixel Panda",
      pronouns: "they/them",
      category: "Gaming / Variety",
      plan: "starter",
      timezone: "America/New_York",
      defaultCurrency: "USD",
    })
    .returning();

  console.log(`Created creator: ${creator.id}`);

  // Create membership for stub user
  await db.insert(schema.memberships).values({
    userId: "stub-user-1",
    creatorId: creator.id,
    role: "owner",
  });

  // Create platforms
  await db.insert(schema.creatorPlatforms).values({
    creatorId: creator.id,
    platform: "twitch",
    ccv: 850,
    followers: 12500,
    scheduleLabel: "Mon/Wed/Fri 8pm ET",
  });

  await db.insert(schema.creatorPlatforms).values({
    creatorId: creator.id,
    platform: "youtube",
    ccv: 420,
    followers: 8200,
    scheduleLabel: "Tue/Thu 7pm ET",
  });

  // Create brands
  const brands = await db
    .insert(schema.brands)
    .values([
      { creatorId: creator.id, name: "Voltaic Energy", category: "Energy Drinks", domain: "voltaic.energy" },
      { creatorId: creator.id, name: "Hexkey", category: "Gaming Peripherals", domain: "hexkey.gg" },
      { creatorId: creator.id, name: "StreamForge", category: "Streaming Software", domain: "streamforge.io" },
      { creatorId: creator.id, name: "Nexus VPN", category: "Cybersecurity", domain: "nexusvpn.com" },
      { creatorId: creator.id, name: "PixelFrames", category: "Eyewear", domain: "pixelframes.co" },
    ])
    .returning();

  console.log(`Created ${brands.length} brands`);

  // Create contacts for brands
  const contacts = await db
    .insert(schema.contacts)
    .values([
      { brandId: brands[0].id, name: "Alex Chen", email: "alex@voltaic.energy", role: "Partnerships Manager" },
      { brandId: brands[1].id, name: "Jordan Smith", email: "jordan@hexkey.gg", role: "Marketing Lead" },
      { brandId: brands[2].id, name: "Casey Rivera", email: "casey@streamforge.io", role: "Creator Relations" },
      { brandId: brands[3].id, name: "Morgan Lee", email: "morgan@nexusvpn.com", role: "Head of Growth" },
      { brandId: brands[4].id, name: "Taylor Kim", email: "taylor@pixelframes.co", role: "Brand Manager" },
    ])
    .returning();

  console.log(`Created ${contacts.length} contacts`);

  // Create deals in various stages
  const deals = await db
    .insert(schema.deals)
    .values([
      {
        creatorId: creator.id,
        brandId: brands[0].id,
        primaryContactId: contacts[0].id,
        title: "Q4 Stream Fuel Campaign",
        type: "flat",
        valueCents: 250000,
        currency: "USD",
        stage: "inbound",
        platforms: ["twitch"],
        paymentTerms: "net_30",
        source: "Brand outreach",
        notes: "3-month sponsorship for energy drink promotion during gaming streams",
      },
      {
        creatorId: creator.id,
        brandId: brands[1].id,
        primaryContactId: contacts[1].id,
        title: "Pro Deck Keyboard Launch",
        type: "flat",
        valueCents: 180000,
        currency: "USD",
        stage: "negotiating",
        platforms: ["twitch", "youtube"],
        paymentTerms: "net_30",
        source: "Referral",
        notes: "Unboxing + 2-week integration during streams",
      },
      {
        creatorId: creator.id,
        brandId: brands[2].id,
        primaryContactId: contacts[2].id,
        title: "StreamForge Affiliate Program",
        type: "bounty",
        valueCents: 50000,
        currency: "USD",
        stage: "contract_sent",
        platforms: ["twitch"],
        paymentTerms: "net_15",
        source: "Inbound inquiry",
        bountyRateNote: "$5 per signup via affiliate link",
        notes: "Performance-based partnership with monthly minimum",
      },
      {
        creatorId: creator.id,
        brandId: brands[3].id,
        primaryContactId: contacts[3].id,
        title: "Nexus VPN Security Month",
        type: "hybrid",
        valueCents: 120000,
        currency: "USD",
        stage: "live",
        platforms: ["twitch", "youtube"],
        paymentTerms: "net_30",
        source: "Cold outreach",
        notes: "$800 flat + $2 per conversion via tracked link",
      },
      {
        creatorId: creator.id,
        brandId: brands[4].id,
        primaryContactId: contacts[4].id,
        title: "PixelFrames Blue Light Collection",
        type: "flat",
        valueCents: 95000,
        currency: "USD",
        stage: "delivered",
        platforms: ["youtube"],
        paymentTerms: "net_30",
        source: "Brand outreach",
        notes: "Dedicated review video + social posts",
      },
      {
        creatorId: creator.id,
        brandId: brands[0].id,
        primaryContactId: contacts[0].id,
        title: "Voltaic Summer Series",
        type: "flat",
        valueCents: 320000,
        currency: "USD",
        stage: "paid",
        platforms: ["twitch"],
        paymentTerms: "net_30",
        source: "Repeat client",
        notes: "6-stream summer campaign completed successfully",
      },
    ])
    .returning();

  console.log(`Created ${deals.length} deals`);

  // Create deliverables for deals
  const deliverables = await db
    .insert(schema.deliverables)
    .values([
      // Q4 Stream Fuel (inbound)
      { dealId: deals[0].id, title: "Intro read (30s)", platform: "twitch", status: "not_started", position: 0 },
      { dealId: deals[0].id, title: "Mid-stream integration", platform: "twitch", status: "not_started", position: 1 },
      { dealId: deals[0].id, title: "Overlay placement", platform: "twitch", status: "not_started", position: 2 },

      // Pro Deck (negotiating)
      { dealId: deals[1].id, title: "Unboxing stream", platform: "twitch", status: "not_started", position: 0 },
      { dealId: deals[1].id, title: "2-week keyboard cam", platform: "twitch", status: "not_started", position: 1 },
      { dealId: deals[1].id, title: "Review video", platform: "youtube", status: "not_started", position: 2 },

      // StreamForge (contract_sent)
      { dealId: deals[2].id, title: "Affiliate link in bio", platform: "twitch", status: "not_started", position: 0 },
      { dealId: deals[2].id, title: "Monthly shoutout", platform: "twitch", status: "not_started", position: 1 },

      // Nexus VPN (live)
      { dealId: deals[3].id, title: "Security tips segment", platform: "twitch", status: "in_progress", position: 0 },
      { dealId: deals[3].id, title: "VPN setup tutorial", platform: "youtube", status: "scheduled", position: 1 },
      { dealId: deals[3].id, title: "Link in description", platform: "youtube", status: "done", position: 2 },

      // PixelFrames (delivered)
      { dealId: deals[4].id, title: "Review video", platform: "youtube", status: "done", position: 0 },
      { dealId: deals[4].id, title: "Instagram story", platform: "tiktok", status: "done", position: 1 },

      // Voltaic Summer (paid)
      { dealId: deals[5].id, title: "6 sponsored streams", platform: "twitch", status: "done", position: 0 },
      { dealId: deals[5].id, title: "Social clips", platform: "tiktok", status: "done", position: 1 },
    ])
    .returning();

  console.log(`Created ${deliverables.length} deliverables`);

  // Create invoices for delivered and paid deals
  const invoices = await db
    .insert(schema.invoices)
    .values([
      {
        creatorId: creator.id,
        dealId: deals[4].id,
        contactId: contacts[4].id,
        number: 1,
        title: "PixelFrames Blue Light Collection",
        amountCents: 95000,
        currency: "USD",
        terms: "net_30",
        status: "open",
        issuedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
        dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // due in 5 days
      },
      {
        creatorId: creator.id,
        dealId: deals[5].id,
        contactId: contacts[0].id,
        number: 2,
        title: "Voltaic Summer Series",
        amountCents: 320000,
        currency: "USD",
        terms: "net_30",
        status: "paid",
        issuedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        paidAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
      },
      {
        creatorId: creator.id,
        dealId: deals[3].id,
        contactId: contacts[3].id,
        number: 3,
        title: "Nexus VPN Security Month — Flat Fee",
        amountCents: 80000,
        currency: "USD",
        terms: "net_30",
        status: "open",
        issuedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days overdue
      },
    ])
    .returning();

  console.log(`Created ${invoices.length} invoices`);

  // Create chase templates
  await db.insert(schema.chaseTemplates).values([
    {
      creatorId: creator.id,
      step: 1,
      name: "Friendly reminder",
      offsetDays: 3,
      subject: "Quick reminder: invoice is due",
      body: "Hi there,\n\nJust a friendly reminder that the invoice is now overdue. Please let me know if you need anything from my side.\n\nBest regards",
      enabled: true,
    },
    {
      creatorId: creator.id,
      step: 2,
      name: "Second notice",
      offsetDays: 14,
      subject: "Second notice: invoice due",
      body: "Hi there,\n\nFollowing up on the invoice. If there's an issue with the payment process, please reach out and I'll resolve it right away.\n\nBest regards",
      enabled: true,
    },
    {
      creatorId: creator.id,
      step: 3,
      name: "Final notice",
      offsetDays: 30,
      subject: "Final notice: invoice overdue",
      body: "Hi there,\n\nThis is a final notice regarding the overdue invoice. Please remit payment within the next 48 hours to avoid further escalation.\n\nBest regards",
      enabled: true,
    },
  ]);

  console.log("Created chase templates");

  // Create chase state for overdue invoice
  await db.insert(schema.invoiceChaseState).values({
    invoiceId: invoices[2].id,
    mode: "armed",
    nextStep: 1,
  });

  console.log("Created invoice chase state");

  console.log("\nSeed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
