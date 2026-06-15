import {
  getActiveMenuAndItem,
  getFirstPagePath,
  getMenuById,
  mainMenus,
} from './menu';

describe('admin menu navigation', () => {
  it('places product management immediately before inventory management', () => {
    const productMenuIndex = mainMenus.findIndex((menu) => menu.id === 'product-management');
    const inventoryMenuIndex = mainMenus.findIndex((menu) => menu.id === 'inventory-product');

    expect(productMenuIndex).toBeGreaterThanOrEqual(0);
    expect(inventoryMenuIndex).toBe(productMenuIndex + 1);
    expect(mainMenus[productMenuIndex]).toMatchObject({
      title: '상품관리',
      defaultPath: '/mall/products-list',
    });
    expect(mainMenus[inventoryMenuIndex]).toMatchObject({
      title: '재고관리',
    });
  });

  it('moves mall product pages under product management', () => {
    expect(getFirstPagePath('product-management')).toBe('/mall/products-list');
    expect(getActiveMenuAndItem('/mall/products-list')).toEqual({
      menuId: 'product-management',
      itemId: 'product-list',
    });
    expect(getActiveMenuAndItem('/mall/products-list/master-1')).toEqual({
      menuId: 'product-management',
      itemId: 'product-list',
    });
    expect(getActiveMenuAndItem('/mall/categories')).toEqual({
      menuId: 'product-management',
      itemId: 'product-category',
    });
  });

  it('keeps own mall non-product pages under own mall management', () => {
    const ownMallMenu = getMenuById('own-mall');

    expect(ownMallMenu?.children.some((item) => item.id === 'products')).toBe(false);
    expect(getActiveMenuAndItem('/mall/banner-groups')).toEqual({
      menuId: 'own-mall',
      itemId: 'banner-groups',
    });
  });

  it('keeps inventory pages under renamed inventory management', () => {
    const inventoryMenu = getMenuById('inventory-product');

    expect(inventoryMenu?.title).toBe('재고관리');
    expect(getActiveMenuAndItem('/inventory/status')).toEqual({
      menuId: 'inventory-product',
      itemId: 'inventory-status',
    });
  });
});
