// ===== Controller Integration Example =====
// This file shows how to use RequireScopes decorator in controllers

import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { RequireScopes } from '@app/authorization';

@Controller('products')
export class ProductsController {
  
  // Anyone with JWT token can access (no scope required)
  @Get('public')
  async getPublicProducts() {
    return { message: 'Public products' };
  }

  // Requires 'product:read' scope
  @Get()
  @RequireScopes('product:read')
  async findAll() {
    return { message: 'List all products' };
  }

  // Requires 'product:read' scope
  @Get(':id')
  @RequireScopes('product:read')
  async findOne(@Param('id') id: string) {
    return { message: `Get product ${id}` };
  }

  // Requires 'product:write' scope
  @Post()
  @RequireScopes('product:write')
  async create(@Body() createDto: any) {
    return { message: 'Create product' };
  }

  // Requires 'product:write' scope
  @Put(':id')
  @RequireScopes('product:write')
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return { message: `Update product ${id}` };
  }

  // Requires 'product:delete' scope
  @Delete(':id')
  @RequireScopes('product:delete')
  async remove(@Param('id') id: string) {
    return { message: `Delete product ${id}` };
  }
}

@Controller('categories')
export class CategoriesController {
  
  @Get()
  @RequireScopes('category:read')
  async findAll() {
    return { message: 'List all categories' };
  }

  @Post()
  @RequireScopes('category:write')
  async create(@Body() createDto: any) {
    return { message: 'Create category' };
  }

  @Delete(':id')
  @RequireScopes('category:delete')
  async remove(@Param('id') id: string) {
    return { message: `Delete category ${id}` };
  }
}

