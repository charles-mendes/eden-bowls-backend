import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { CreateAddressDto } from './dto/create-address.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { UsersService } from './users.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users/me')
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.getMe(user.userId);
  }

  @Put('users/me/profile')
  upsertMyProfile(@CurrentUser() user: AuthUser, @Body() body: UpsertProfileDto) {
    return this.usersService.upsertMyProfile(user.userId, body);
  }

  @Get('users/me/addresses')
  listMyAddresses(@CurrentUser() user: AuthUser) {
    return this.usersService.listMyAddresses(user.userId);
  }

  @Post('users/me/addresses')
  createMyAddress(@CurrentUser() user: AuthUser, @Body() body: CreateAddressDto) {
    return this.usersService.createMyAddress(user.userId, body);
  }

  @Patch('users/me/addresses/:addressId')
  updateMyAddress(
    @CurrentUser() user: AuthUser,
    @Param('addressId') addressId: string,
    @Body() body: UpdateAddressDto,
  ) {
    return this.usersService.updateMyAddress(user.userId, addressId, body);
  }

  @Delete('users/me/addresses/:addressId')
  deleteMyAddress(@CurrentUser() user: AuthUser, @Param('addressId') addressId: string) {
    return this.usersService.deleteMyAddress(user.userId, addressId);
  }

  @Get('admin/users')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  listUsers(@CurrentUser() user: AuthUser, @Query() query: ListUsersQueryDto) {
    return this.usersService.listUsers(query, user);
  }
}
