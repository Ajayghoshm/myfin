import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import { CATEGORY_ICON_KEYS, DEFAULT_CATEGORY_ICON_KEY, MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import CategoryService from '../services/categoryService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

// READ
const getAllCategoriesForUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const list = await CategoryService.getAllCategoriesForUser(sessionData.userId);
    res.json(list);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const createCategorySchema = joi.object({
  name: joi.string().trim().required(),
  description: joi.string().trim().empty('').default(''),
  color_gradient: joi.string().trim().required(),
  icon_key: joi.string().trim().valid(...CATEGORY_ICON_KEYS).default(DEFAULT_CATEGORY_ICON_KEY),
  status: joi.string().valid(MYFIN.CATEGORY_STATUS.ACTIVE, MYFIN.CATEGORY_STATUS.INACTIVE),
  exclude_from_budgets: joi.boolean().truthy(1, '1').falsy(0, '0').required(),
  is_fixed: joi.boolean().truthy(1, '1').falsy(0, '0').optional(),
  parent_category_id: joi.number().allow(null).optional(),
});

// eslint-disable-next-line consistent-return
const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await createCategorySchema.validateAsync(req.body);
    const category = await CategoryService.createCategory({
      users_user_id: sessionData.userId,
      ...input,
      parent_category_id:
        input.parent_category_id !== undefined && input.parent_category_id !== null
          ? BigInt(input.parent_category_id)
          : null,
      exclude_from_budgets: +input.exclude_from_budgets,
      type: 'M',
    });

    // returned so clients can select a category they just created
    return res.json({ category_id: category.category_id, name: category.name });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

// UPDATE
const updateCategorySchema = joi.object({
  category_id: joi.number().required(),
  new_name: joi.string().trim().required(),
  new_description: joi.string().trim().empty('').default(''),
  new_color_gradient: joi.string().trim().required(),
  new_icon_key: joi.string().trim().valid(...CATEGORY_ICON_KEYS).optional(),
  new_status: joi.string().valid(MYFIN.CATEGORY_STATUS.ACTIVE, MYFIN.CATEGORY_STATUS.INACTIVE),
  new_exclude_from_budgets: joi.boolean().truthy(1, '1').falsy(0, '0').required(),
  new_is_fixed: joi.boolean().truthy(1, '1').falsy(0, '0').optional(),
  new_parent_category_id: joi.number().allow(null).optional(),
});

// eslint-disable-next-line consistent-return
const updateCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await updateCategorySchema.validateAsync(req.body);
    await CategoryService.updateCategory(sessionData.userId, input.category_id, {
      name: input.new_name,
      description: input.new_description,
      color_gradient: input.new_color_gradient,
      ...(input.new_icon_key !== undefined ? { icon_key: input.new_icon_key } : {}),
      status: input.new_status,
      exclude_from_budgets: +input.new_exclude_from_budgets,
      ...(input.new_is_fixed !== undefined ? { is_fixed: input.new_is_fixed } : {}),
    });

    if (input.new_parent_category_id !== undefined) {
      await CategoryService.setCategoryParent(
        sessionData.userId,
        BigInt(input.category_id),
        input.new_parent_category_id === null ? null : BigInt(input.new_parent_category_id)
      );
    }

    return res.json('Category successfully updated!');
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

// MERGE
const mergeCategoriesSchema = joi.object({
  source_category_id: joi.number().required(),
  target_category_id: joi.number().required(),
});

// eslint-disable-next-line consistent-return
const mergeCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await mergeCategoriesSchema.validateAsync(req.body);
    await CategoryService.mergeCategories(
      sessionData.userId,
      BigInt(input.source_category_id),
      BigInt(input.target_category_id)
    );

    return res.json('Categories successfully merged!');
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

// DELETE
const deleteCategorySchema = joi.object({
  category_id: joi.number().required(),
});

// eslint-disable-next-line consistent-return
const deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const category = await deleteCategorySchema.validateAsync(req.body);
    await CategoryService.deleteCategory(sessionData.userId, category.category_id);

    return res.json('Category successfully deleted!');
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

export default {
  getAllCategoriesForUser,
  createCategory,
  updateCategory,
  mergeCategories,
  deleteCategory,
};
