import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { CreatePetDto } from './dto/create-pet.dto';
import { ListBreedsQueryDto } from './dto/list-breeds-query.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { PetsService } from './pets.service';

@Controller()
export class PetsController {
  constructor(private readonly petsService: PetsService) {}

  @Get('breeds')
  listBreeds(@Query() query: ListBreedsQueryDto) {
    return this.petsService.listBreeds(query);
  }

  @Get('pets')
  @UseGuards(JwtAuthGuard)
  listMyPets(@CurrentUser() user: AuthUser) {
    return this.petsService.listMyPets(user.userId);
  }

  @Post('pets')
  @UseGuards(JwtAuthGuard)
  createPet(@CurrentUser() user: AuthUser, @Body() body: CreatePetDto) {
    return this.petsService.createPet(user.userId, body);
  }

  @Patch('pets/:petId')
  @UseGuards(JwtAuthGuard)
  updatePet(
    @CurrentUser() user: AuthUser,
    @Param('petId') petId: string,
    @Body() body: UpdatePetDto,
  ) {
    return this.petsService.updatePet(user.userId, petId, body);
  }

  @Delete('pets/:petId')
  @UseGuards(JwtAuthGuard)
  deletePet(@CurrentUser() user: AuthUser, @Param('petId') petId: string) {
    return this.petsService.deletePet(user.userId, petId);
  }
}
