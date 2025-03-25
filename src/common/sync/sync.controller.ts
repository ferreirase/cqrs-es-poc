import { Controller } from '@nestjs/common';
import { DataSyncService } from './sync.service';

@Controller('admin/sync')
export class SyncController {
  constructor(private readonly syncService: DataSyncService) {}

  // @Post()
  // async syncData() {
  //   return this.syncService.forceSyncAll();
  // }
}
