/// <reference types="vite/client" />

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

type WellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

interface Window {
  showOpenFilePicker(options?: {
    id?: string;
    startIn?: WellKnownDirectory | FileSystemHandle;
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: {
    id?: string;
    suggestedName?: string;
    startIn?: WellKnownDirectory | FileSystemHandle;
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
  }): Promise<FileSystemFileHandle>;
}
