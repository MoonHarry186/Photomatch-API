import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Public } from '../common/auth-context';
import { CatalogService } from './catalog.service';

class FieldQuery {
  @IsOptional()
  @IsEnum(RoleCode)
  role?: RoleCode;
}

class ServiceQuery {
  @IsOptional()
  @IsUUID()
  activityFieldId?: string;
}

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('cities')
  cities() {
    return this.catalog.cities();
  }

  @Get('activity-fields')
  fields(@Query() query: FieldQuery) {
    return this.catalog.fields(query.role);
  }

  @Get('services')
  services(@Query() query: ServiceQuery) {
    return this.catalog.services(query.activityFieldId);
  }

  @Get('legal-documents/current')
  currentLegal() {
    return this.catalog.currentLegal();
  }
}
