import { PrismaClient } from '@prisma/client';
import { SEED_RESTAURANTS } from './data/restaurants.seed';

const prisma = new PrismaClient();

async function seedRestaurants(): Promise<void> {
  const existing = await prisma.restaurant.count();
  if (existing > 0) {
    console.log(`[seed] restaurants already populated (${existing}) - skip`);
    return;
  }

  await prisma.$transaction(
    SEED_RESTAURANTS.map((data) =>
      prisma.restaurant.create({
        data: {
          ...data,
          source: data.source ?? 'seed',
          lastVerifiedAt: new Date(),
        },
      }),
    ),
  );

  console.log(`[seed] inserted ${SEED_RESTAURANTS.length} restaurants`);
}

async function main(): Promise<void> {
  await seedRestaurants();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
