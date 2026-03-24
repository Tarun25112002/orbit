"use client"
import { Id } from "../../../../convex/_generated/dataModel";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useProject } from "../hooks/use-projects";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { Spinner } from "@/components/ui/spinner";
export const Navbar = ({ projectId }: { projectId: Id<"projects"> }) => {
    const project = useProject(projectId)
  return (
    <>
      <nav>
        <div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink>
                  <Button>
                    <Link href="/">
                      <Image
                        src="/logo.png"
                        alt="Home"
                        width={24}
                        height={24}
                      />
                    </Link>
                  </Button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem></BreadcrumbItem>
              <BreadcrumbPage>{project?.name??<Spinner/>}</BreadcrumbPage>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div>
          <UserButton/>
        </div>
      </nav>
    </>
  );
};
