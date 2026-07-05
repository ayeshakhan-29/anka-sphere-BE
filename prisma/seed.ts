import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/anka_sphere';

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

/**
 * Wait for the database to accept connections before seeding.
 * On deploys the app container often boots before the DB is ready; that
 * previously threw ECONNREFUSED and crash-looped the whole process.
 */
async function waitForDb(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.warn(`DB not reachable (attempt ${attempt}/${retries}): ${reason}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  await waitForDb();

  const passwordHash = await bcrypt.hash('password', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@anka.agency' },
    update: {},
    create: {
      email: 'admin@anka.agency',
      passwordHash,
      name: 'Ayesha K.',
      role: 'ADMIN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'james@anka.agency' },
    update: {},
    create: { email: 'james@anka.agency', passwordHash, name: 'James D.', role: 'DEVELOPER' },
  });

  await prisma.user.upsert({
    where: { email: 'sara@anka.agency' },
    update: {},
    create: { email: 'sara@anka.agency', passwordHash, name: 'Sara M.', role: 'DESIGNER' },
  });

  await prisma.user.upsert({
    where: { email: 'liam@anka.agency' },
    update: {},
    create: { email: 'liam@anka.agency', passwordHash, name: 'Liam T.', role: 'SEO' },
  });

  // Seed a sample project
  const existing = await prisma.project.findFirst({ where: { clientName: 'Lumina Studios' } });
  if (!existing) {
    await prisma.project.create({
      data: {
        name: 'Brand Refresh & Website',
        clientName: 'Lumina Studios',
        status: 'ACTIVE',
        currentStage: 'DESIGN',
        description: 'Full brand identity refresh including new logo, colour palette, and a 6-page WordPress website.',
        startDate: new Date('2026-04-01'),
        targetDate: new Date('2026-06-30'),
        createdById: admin.id,
        pipeline: {
          create: [
            { stage: 'PROFILING',       status: 'APPROVED',     approvedAt: new Date('2026-04-10') },
            { stage: 'WRITTEN_CONTENT', status: 'APPROVED',     approvedAt: new Date('2026-04-25') },
            { stage: 'DESIGN',          status: 'IN_PROGRESS',  startedAt: new Date('2026-04-26') },
            { stage: 'DEVELOPMENT',     status: 'LOCKED' },
            { stage: 'MARKETING',       status: 'LOCKED' },
          ],
        },
        milestones: {
          create: [
            { label: 'Client brief sign-off',     status: 'DONE',    sortOrder: 1 },
            { label: 'Brand inputs submitted',    status: 'DONE',    sortOrder: 2 },
            { label: 'Profiling complete (Hard Gate)', status: 'DONE', sortOrder: 3 },
            { label: 'Written content approved',  status: 'DONE',    sortOrder: 4 },
            { label: 'Design concepts delivered', status: 'PENDING', sortOrder: 5 },
          ],
        },
      },
    });
  }

  // Seed a demo project at the Marketing stage so Growth dashboards have data
  const growthExisting = await prisma.project.findFirst({ where: { clientName: 'Verdant Foods' } });
  if (!growthExisting) {
    await prisma.project.create({
      data: {
        name: 'Post-Launch Growth Campaign',
        clientName: 'Verdant Foods',
        status: 'ACTIVE',
        currentStage: 'MARKETING',
        description: 'Organic social, content marketing, and paid campaigns for the newly launched Verdant Foods e-commerce site.',
        startDate: new Date('2026-02-10'),
        targetDate: new Date('2026-09-30'),
        createdById: admin.id,
        pipeline: {
          create: [
            { stage: 'PROFILING',       status: 'APPROVED',    approvedAt: new Date('2026-02-20') },
            { stage: 'WRITTEN_CONTENT', status: 'APPROVED',    approvedAt: new Date('2026-03-15') },
            { stage: 'DESIGN',          status: 'APPROVED',    approvedAt: new Date('2026-04-10') },
            { stage: 'DEVELOPMENT',     status: 'APPROVED',    approvedAt: new Date('2026-05-25') },
            { stage: 'MARKETING',       status: 'IN_PROGRESS', startedAt: new Date('2026-06-01') },
          ],
        },
        milestones: {
          create: [
            { label: 'Website launched',            status: 'DONE',    sortOrder: 1 },
            { label: 'Growth strategy approved',    status: 'DONE',    sortOrder: 2 },
            { label: 'First month social calendar', status: 'DONE',    sortOrder: 3 },
            { label: 'Paid campaigns live',         status: 'PENDING', sortOrder: 4 },
            { label: 'First monthly report',        status: 'PENDING', sortOrder: 5 },
          ],
        },
        marketing: {
          create: {
            strategy: 'Build brand awareness through organic social and food-blogger collaborations, then scale winning content with paid campaigns.',
            targetAudience: 'Health-conscious home cooks aged 25–45, urban, active on Instagram and TikTok.',
            budget: '$4,500 / month',
            channels: 'Instagram, TikTok, Facebook, LinkedIn',
            notes: 'Client wants weekly Reels; avoid stock photography — use launch shoot assets from the Design library.',
            tasks: {
              create: [
                { title: 'Instagram launch announcement post',       category: 'SOCIAL',    status: 'DONE',        priority: 'HIGH',   assigneeName: 'Mina R.',  sortOrder: 1 },
                { title: 'Recipe Reel — 5-minute lunch bowls',       category: 'SOCIAL',    status: 'DONE',        priority: 'MEDIUM', assigneeName: 'Mina R.',  sortOrder: 2 },
                { title: 'TikTok behind-the-scenes kitchen tour',    category: 'SOCIAL',    status: 'IN_PROGRESS', priority: 'HIGH',   assigneeName: 'Mina R.',  sortOrder: 3 },
                { title: 'Founder story carousel (IG + LinkedIn)',   category: 'SOCIAL',    status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeName: 'Omar S.',  sortOrder: 4 },
                { title: 'July content calendar — week 3 posts',     category: 'SOCIAL',    status: 'IN_REVIEW',   priority: 'MEDIUM', assigneeName: 'Mina R.',  sortOrder: 5 },
                { title: 'Community replies + DM triage (weekly)',   category: 'SOCIAL',    status: 'TODO',        priority: 'LOW',    assigneeName: 'Omar S.',  sortOrder: 6 },
                { title: 'Hashtag research — seasonal produce',      category: 'SOCIAL',    status: 'TODO',        priority: 'LOW',    assigneeName: 'Mina R.',  sortOrder: 7 },
                { title: 'Blog post — meal-prep guide',              category: 'CONTENT',   status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeName: 'Hana K.',  sortOrder: 8 },
                { title: 'Email — launch week newsletter',           category: 'CONTENT',   status: 'DONE',        priority: 'HIGH',   assigneeName: 'Hana K.',  sortOrder: 9 },
                { title: 'Meta ads — retargeting creative set',      category: 'PAID',      status: 'TODO',        priority: 'HIGH',   assigneeName: 'Adil B.',  sortOrder: 10 },
                { title: 'Google Ads — brand search campaign',       category: 'PAID',      status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeName: 'Adil B.',  sortOrder: 11 },
                { title: 'On-page SEO pass — product pages',         category: 'SEO',       status: 'IN_REVIEW',   priority: 'MEDIUM', assigneeName: 'Liam T.',  sortOrder: 12 },
                { title: 'GA4 conversion events audit',              category: 'ANALYTICS', status: 'TODO',        priority: 'MEDIUM', assigneeName: 'Liam T.',  sortOrder: 13 },
              ],
            },
          },
        },
      },
    });
  }

  // ── Backfill department details for the demo projects ──────────────────────
  // Runs even if the projects already exist, so deployed DBs get the data too.

  const verdant = await prisma.project.findFirst({ where: { clientName: 'Verdant Foods' } });
  if (verdant) {
    // Stage 1 — Profiling
    if (!(await prisma.projectProfiling.findUnique({ where: { projectId: verdant.id } }))) {
      await prisma.projectProfiling.create({
        data: {
          projectId: verdant.id,
          companyName: 'Verdant Foods',
          industry: 'Food & Beverage · Organic grocery e-commerce',
          about: 'Verdant Foods delivers organic, locally sourced produce boxes and pantry staples across the Berlin metro area, with a focus on sustainability and zero-waste packaging.',
          objectives: 'Launch an e-commerce store, reach 1,000 monthly subscription boxes within 12 months, and build a recognisable local brand.',
          scope: '6-page WordPress WooCommerce site, brand identity refresh, product photography, and a post-launch growth campaign.',
          budget: '$25,000 build + $4,500/month growth retainer',
          priority: 'HIGH',
          brandVoice: 'Fresh, honest, and down-to-earth — like a knowledgeable friend at the farmers market.',
          tagline: 'Good food, grown close.',
          brandColours: '#166534 forest green, #FDE68A wheat, #FAFAF9 off-white',
          typography: 'Fraunces for headings, Inter for body text',
          brandRefs: 'oddbox.co.uk and misfitsmarket.com — organic feel without looking rustic',
          brandDislikes: 'No generic stock photos of vegetables, no cartoon illustrations, no neon colours.',
          primaryKeywords: 'organic veg box delivery, organic groceries online',
          secondaryKeywords: 'local produce delivery, zero waste grocery, seasonal veg box',
          existingDomain: 'verdantfoods.com',
          localSeo: 'Target area: Berlin metro. Google Business Profile set up for the packing hub.',
          seoNotes: 'Blog targets long-tail recipe keywords; product pages need Product schema markup.',
          completedAt: new Date('2026-02-20'),
          personas: {
            create: [
              { name: 'Busy Health-Conscious Parent', ageRange: '30–45', jobRole: 'Working parent', painPoints: 'No time to shop for quality produce; distrusts supermarket "organic" labels.', goals: 'Feed the family healthy meals without extra shopping trips.', sortOrder: 1 },
              { name: 'Eco-Minded Young Professional', ageRange: '24–35', jobRole: 'Urban professional', painPoints: 'Plastic-packaging guilt; produce spoils before it gets used.', goals: 'Reduce footprint and cook more seasonal meals.', sortOrder: 2 },
            ],
          },
          competitors: {
            create: [
              { name: 'Oddbox', websiteUrl: 'https://www.oddbox.co.uk', strength: 'Strong sustainability story and social presence.', weakness: 'Limited range beyond rescue boxes.', sortOrder: 1 },
              { name: 'Misfits Market', websiteUrl: 'https://www.misfitsmarket.com', strength: 'Aggressive pricing and wide product range.', weakness: 'Inconsistent quality reviews; weak local branding.', sortOrder: 2 },
            ],
          },
        },
      });
    }

    // Stage 2 — Written Content
    if (!(await prisma.writtenContent.findUnique({ where: { projectId: verdant.id } }))) {
      await prisma.writtenContent.create({
        data: {
          projectId: verdant.id,
          contentBrief: 'Warm, sensory copy that makes seasonal produce feel exciting. Every page reinforces the local-and-organic promise and ends with a subscription CTA.',
          toneOfVoice: 'Friendly, confident, lightly playful. Short sentences. No jargon, no guilt-tripping.',
          seoGuidelines: 'One H1 per page; primary keyword in the title and first 100 words; meta descriptions 150–160 characters.',
          completedAt: new Date('2026-03-15'),
          pages: {
            create: [
              { title: 'Home', slug: 'home', status: 'APPROVED', wordCount: 480, seoTitle: 'Organic Veg Box Delivery in Berlin | Verdant Foods', seoDescription: 'Organic, locally grown produce boxes delivered to your door. Zero-waste packaging, flexible subscriptions, and food that tastes like the season.', body: 'Good food, grown close. Verdant Foods brings the best of local organic farms straight to your kitchen — picked this week, delivered this week.', sortOrder: 1 },
              { title: 'About Us', slug: 'about', status: 'APPROVED', wordCount: 620, seoTitle: 'Our Story | Verdant Foods', seoDescription: 'From one market stall to Berlin’s favourite organic box. Meet the farmers and the promise behind Verdant Foods.', body: 'We started with a single stall and a simple belief: organic food should be local, honest, and affordable.', sortOrder: 2 },
              { title: 'Veg Boxes', slug: 'veg-boxes', status: 'APPROVED', wordCount: 540, seoTitle: 'Seasonal Veg Boxes | Verdant Foods', seoDescription: 'Choose your size, set your schedule. Seasonal organic veg boxes with zero-waste packaging and free delivery over €35.', body: 'Small, family, or feast — every box is packed with what the season does best.', sortOrder: 3 },
              { title: 'Delivery FAQ', slug: 'delivery-faq', status: 'APPROVED', wordCount: 390, seoTitle: 'Delivery Areas & FAQ | Verdant Foods', seoDescription: 'Where we deliver, when your box arrives, and how our zero-waste returns work.', body: 'We deliver across the Berlin metro area, Tuesday to Saturday.', sortOrder: 4 },
              { title: 'Blog: 10 Quick Dinners From One Veg Box', slug: 'blog-10-quick-dinners', status: 'PUBLISHED', wordCount: 1250, seoTitle: '10 Quick Dinners From One Veg Box | Verdant Foods Blog', seoDescription: 'Stretch a single seasonal veg box into ten weeknight dinners with these fast, flexible recipes.', body: 'One box, ten dinners — here’s how our kitchen team turns a weekly box into a full menu.', sortOrder: 5 },
            ],
          },
        },
      });
    }

    // Stage 3 — Design
    if (!(await prisma.design.findUnique({ where: { projectId: verdant.id } }))) {
      await prisma.design.create({
        data: {
          projectId: verdant.id,
          brief: 'Editorial, appetising e-commerce design. Big seasonal photography, forest-green primary palette, generous whitespace. Product cards must show origin farm and what’s-in-the-box at a glance.',
          styleGuide: '8pt spacing grid. Fraunces display / Inter body. Rounded-lg cards with soft shadows. Photography: natural light, real kitchens, no studio white.',
          completedAt: new Date('2026-04-10'),
          tasks: {
            create: [
              { title: 'Brand refresh — logo & palette', status: 'DONE', priority: 'HIGH', assigneeName: 'Sara M.', sortOrder: 1 },
              { title: 'Homepage hero + product card designs', status: 'DONE', priority: 'HIGH', assigneeName: 'Sara M.', sortOrder: 2 },
              { title: 'Checkout & subscription flow UX', status: 'DONE', priority: 'MEDIUM', assigneeName: 'Sara M.', sortOrder: 3 },
              { title: 'Transactional email templates', status: 'DONE', priority: 'LOW', assigneeName: 'Sara M.', sortOrder: 4 },
            ],
          },
          assets: {
            create: [
              { name: 'Primary logo — full colour', type: 'IMAGE', url: 'https://picsum.photos/seed/verdant-logo/800/500', notes: 'Approved master logo on off-white.', version: 2, approvedAt: new Date('2026-04-08') },
              { name: 'Launch photography set (24 images)', type: 'IMAGE', url: 'https://picsum.photos/seed/verdant-photo/800/500', notes: 'Season 1 shoot — kitchens and market stalls.', version: 1, approvedAt: new Date('2026-04-09') },
              { name: 'Brand guidelines v1.0', type: 'DOCUMENT', url: 'https://verdantfoods.com/brand/guidelines-v1.pdf', notes: 'Logo usage, palette, typography, photography rules.', version: 1, approvedAt: new Date('2026-04-10') },
            ],
          },
        },
      });
    }

    // Stage 4 — Development (record may already exist but be empty)
    const verdantDev = await prisma.development.upsert({
      where: { projectId: verdant.id },
      update: {},
      create: { projectId: verdant.id },
      include: { tasks: true },
    });
    if (!verdantDev.techStack) {
      await prisma.development.update({
        where: { projectId: verdant.id },
        data: {
          techStack: 'WordPress + WooCommerce Subscriptions, Tailwind child theme',
          repoUrl: 'https://github.com/anka-agency/verdant-foods',
          stagingUrl: 'https://staging.verdantfoods.com',
          liveUrl: 'https://verdantfoods.com',
          notes: 'Launched 25 May 2026. Weekly plugin updates under the maintenance retainer.',
          completedAt: new Date('2026-05-25'),
        },
      });
    }
    if (verdantDev.tasks.length === 0) {
      await prisma.devTask.createMany({
        data: [
          { developmentId: verdantDev.id, title: 'Theme build — home & product templates', status: 'LIVE', priority: 'HIGH', assigneeName: 'James D.', sortOrder: 1 },
          { developmentId: verdantDev.id, title: 'WooCommerce subscriptions & checkout', status: 'LIVE', priority: 'HIGH', assigneeName: 'James D.', sortOrder: 2 },
          { developmentId: verdantDev.id, title: 'Performance pass — LCP under 2.5s', status: 'LIVE', priority: 'MEDIUM', assigneeName: 'James D.', sortOrder: 3 },
          { developmentId: verdantDev.id, title: 'Uptime & backup monitoring setup', status: 'MAINTENANCE', priority: 'LOW', assigneeName: 'James D.', sortOrder: 4 },
        ],
      });
    }
  }

  // Lumina Studios — mid-pipeline demo (Design stage in progress)
  const lumina = await prisma.project.findFirst({ where: { clientName: 'Lumina Studios' } });
  if (lumina) {
    if (!(await prisma.projectProfiling.findUnique({ where: { projectId: lumina.id } }))) {
      await prisma.projectProfiling.create({
        data: {
          projectId: lumina.id,
          companyName: 'Lumina Studios',
          industry: 'Creative · Photography & video production',
          about: 'Boutique photography and video studio serving fashion and hospitality clients.',
          objectives: 'Reposition the brand upmarket and win larger commercial contracts through a portfolio-first website.',
          scope: 'Brand identity refresh plus a 6-page WordPress portfolio site.',
          budget: '$18,000',
          priority: 'MEDIUM',
          brandVoice: 'Polished, cinematic, quietly confident.',
          tagline: 'Light, captured.',
          brandColours: '#0F172A ink, #E2E8F0 silver, #C2410C ember accent',
          typography: 'Editorial serif for headings, neutral grotesque for body',
          primaryKeywords: 'commercial photography studio, fashion photographer Berlin',
          completedAt: new Date('2026-04-10'),
          personas: {
            create: [
              { name: 'Brand / Marketing Manager', ageRange: '28–45', jobRole: 'Marketing lead at fashion or hospitality brand', painPoints: 'Hard to judge studio quality before committing budget.', goals: 'A reliable creative partner who delivers on brief and on time.', sortOrder: 1 },
            ],
          },
          competitors: {
            create: [
              { name: 'Studio Nord', strength: 'Big-name client list.', weakness: 'Premium pricing, slow turnaround.', sortOrder: 1 },
            ],
          },
        },
      });
    }

    if (!(await prisma.writtenContent.findUnique({ where: { projectId: lumina.id } }))) {
      await prisma.writtenContent.create({
        data: {
          projectId: lumina.id,
          contentBrief: 'Minimal copy that lets the imagery lead. Case-study pages follow challenge → approach → result.',
          toneOfVoice: 'Understated and precise. Confidence without superlatives.',
          completedAt: new Date('2026-04-25'),
          pages: {
            create: [
              { title: 'Home', slug: 'home', status: 'APPROVED', wordCount: 220, sortOrder: 1 },
              { title: 'Portfolio', slug: 'portfolio', status: 'APPROVED', wordCount: 180, sortOrder: 2 },
              { title: 'About & Studio', slug: 'about', status: 'APPROVED', wordCount: 450, sortOrder: 3 },
            ],
          },
        },
      });
    }

    if (!(await prisma.design.findUnique({ where: { projectId: lumina.id } }))) {
      await prisma.design.create({
        data: {
          projectId: lumina.id,
          brief: 'Dark, gallery-like portfolio. Full-bleed imagery, restrained typography, ember accent for CTAs only.',
          styleGuide: 'Ink background throughout. 12-column grid, images break the grid deliberately.',
          tasks: {
            create: [
              { title: 'Moodboard & art direction', status: 'DONE', priority: 'HIGH', assigneeName: 'Sara M.', sortOrder: 1 },
              { title: 'Homepage & portfolio grid concepts', status: 'IN_REVIEW', priority: 'HIGH', assigneeName: 'Sara M.', sortOrder: 2 },
              { title: 'Case-study template', status: 'IN_PROGRESS', priority: 'MEDIUM', assigneeName: 'Sara M.', sortOrder: 3 },
              { title: 'Logo refinement round 2', status: 'TODO', priority: 'MEDIUM', assigneeName: 'Sara M.', sortOrder: 4 },
            ],
          },
          assets: {
            create: [
              { name: 'Moodboard — art direction v2', type: 'IMAGE', url: 'https://picsum.photos/seed/lumina-mood/800/500', notes: 'Approved direction: dark gallery aesthetic.', version: 2, approvedAt: new Date('2026-05-02') },
            ],
          },
        },
      });
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
