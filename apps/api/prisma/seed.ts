import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const roles = [
    { code: 'admin', name: 'Administrator' },
    { code: 'operator', name: 'Operator' },
    { code: 'readonly', name: 'Read Only' },
    { code: 'customer', name: 'Customer' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: role,
    });
  }

  const permissions = [
    { resource: 'users', action: 'read', code: 'users:read' },
    { resource: 'users', action: 'write', code: 'users:write' },
    { resource: 'billing', action: 'read', code: 'billing:read' },
    { resource: 'billing', action: 'write', code: 'billing:write' },
    { resource: 'catalog', action: 'read', code: 'catalog:read' },
    { resource: 'catalog', action: 'write', code: 'catalog:write' },
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        resource: permission.resource,
        action: permission.action,
      },
      create: permission,
    });
  }

  const [adminRole, operatorRole, readonlyRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: 'admin' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'operator' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'readonly' } }),
  ]);

  const allPermissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });

  const adminPermissionIds = allPermissions.map((p) => p.id);
  const operatorPermissionIds = allPermissions
    .filter((p) => p.code.endsWith(':read'))
    .map((p) => p.id);
  const readonlyPermissionIds = allPermissions
    .filter((p) => p.code.endsWith(':read'))
    .map((p) => p.id);

  for (const permissionId of adminPermissionIds) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId,
      },
    });
  }

  for (const permissionId of operatorPermissionIds) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: operatorRole.id,
          permissionId,
        },
      },
      update: {},
      create: {
        roleId: operatorRole.id,
        permissionId,
      },
    });
  }

  for (const permissionId of readonlyPermissionIds) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: readonlyRole.id,
          permissionId,
        },
      },
      update: {},
      create: {
        roleId: readonlyRole.id,
        permissionId,
      },
    });
  }

  await prisma.businessRulesConfig.upsert({
    where: {
      domain_key_marketCountry_effectiveFrom: {
        domain: 'billing',
        key: 'retry_policy',
        marketCountry: 'BR',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    },
    update: {
      valueJson: {
        maxAttempts: 3,
        intervalHours: [24, 48, 72],
      },
      active: true,
    },
    create: {
      domain: 'billing',
      key: 'retry_policy',
      marketCountry: 'BR',
      valueJson: {
        maxAttempts: 3,
        intervalHours: [24, 48, 72],
      },
      active: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
